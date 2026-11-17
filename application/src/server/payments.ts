/**
 * Payment/payout provider boundary. Mock providers are internal adapters with production-shaped,
 * HMAC-signed callbacks that go through the same inbox + domain handlers as the HTTP webhook route.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { MODEL_ID, Q, tx } from './db';
import {
  AppError, addMinutes, audit, big, clock, fail, iso, notify, outbox, parties, post, sha256, sum, tehranIso, uuid,
} from './core';
import { allocatePayment, nextBusinessDate, roundHalfUp } from './kit';
import { cureHolds, installments, refreshInstallmentStatuses, releaseOutstanding, residual } from './services';
import { content } from './db';

const SECRET = process.env.WEBHOOK_SECRET || 'demo-webhook-secret-not-for-production';
export type Effect = () => Promise<void>;

export interface Envelope { event_id: string; type: string; occurred_at: string; data: Record<string, any> }
export function sign(raw: string, timestamp: string) {
  return createHmac('sha256', SECRET).update(`${timestamp}.${raw}`).digest('hex');
}

/** Webhook entry point shared by HTTP route and in-process mock delivery. */
export async function receiveWebhook(provider: string, raw: string, signature: string | null, timestamp: string | null) {
  if (!signature || !timestamp) fail('WEBHOOK_UNSIGNED', 401, 'امضای رویداد موجود نیست.');
  const skew = Math.abs(Date.now() - Number(timestamp) * 1000);
  if (!Number.isFinite(skew) || skew > 5 * 60000) fail('WEBHOOK_STALE', 401, 'زمان رویداد معتبر نیست.');
  const expected = Buffer.from(sign(raw, timestamp!), 'hex');
  const given = Buffer.from(String(signature).replace(/^sha256=/, ''), 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) fail('WEBHOOK_SIGNATURE', 401, 'امضای رویداد نامعتبر است.');
  const env = JSON.parse(raw) as Envelope;
  const effects: Effect[] = [];
  const result = await tx(null, async (t) => {
    const now = await clock(t);
    const ins = await t.one(`INSERT INTO webhook_inbox(model_id,provider,event_key,payload_hash,payload,status) VALUES ($1,$2,$3,$4,$5,'RECEIVED')
        ON CONFLICT (model_id,provider,event_key) DO NOTHING RETURNING id`, [MODEL_ID, provider, env.event_id, sha256(raw), JSON.stringify({ type: env.type, data: env.data, redacted: true })]);
    if (!ins) return { duplicate: true, event_id: env.event_id };
    let outcome: any;
    switch (env.type) {
      case 'payment.succeeded': outcome = await confirmPayment(t, env.data, effects); break;
      case 'payment.failed': outcome = await failPayment(t, env.data); break;
      case 'payment.unknown': outcome = await unknownPayment(t, env.data); break;
      case 'payout.confirmed': outcome = await payoutResult(t, env.data, 'CONFIRMED'); break;
      case 'payout.failed': outcome = await payoutResult(t, env.data, 'FAILED'); break;
      case 'payout.unknown': outcome = await payoutResult(t, env.data, 'UNKNOWN'); break;
      default: fail('UNSUPPORTED_EVENT', 400);
    }
    await t.q("UPDATE webhook_inbox SET status='PROCESSED', processed_at=$2, version=version+1, updated_at=now() WHERE id=$1", [ins.id, iso(now)]);
    return { duplicate: false, event_id: env.event_id, outcome };
  });
  for (const e of effects) await e();
  return result;
}

/** Mock provider delivers a signed callback in-process (no network). */
export async function deliver(provider: string, env: Envelope) {
  const raw = JSON.stringify(env);
  const ts = String(Math.floor(Date.now() / 1000));
  return receiveWebhook(provider, raw, sign(raw, ts), ts);
}

const scenarioOf = (ref: string) => (/^MOCK-([A-Z]+)-/.exec(ref)?.[1] ?? 'SUCCESS');

/** Called after the command that created the intent commits. */
export async function mockPaymentProvider(intentId: string) {
  const intent = await tx(null, (t) => t.one('SELECT * FROM payment_intents WHERE id=$1', [intentId]));
  if (!intent) return;
  const ref = intent.provider_intent_ref as string;
  const data = { provider_intent_ref: ref, provider_reference: `RCPT-${ref}`, amount_irr: String(intent.amount_irr), currency: 'IRR' };
  const now = new Date().toISOString();
  switch (scenarioOf(ref)) {
    case 'SUCCESS': await deliver('mock-pay', { event_id: `EVT-${ref}`, type: 'payment.succeeded', occurred_at: now, data }); break;
    case 'DUPLICATE':
      await deliver('mock-pay', { event_id: `EVT-${ref}`, type: 'payment.succeeded', occurred_at: now, data });
      await deliver('mock-pay', { event_id: `EVT-${ref}`, type: 'payment.succeeded', occurred_at: now, data });
      break;
    case 'FAILED': await deliver('mock-pay', { event_id: `EVT-${ref}`, type: 'payment.failed', occurred_at: now, data }); break;
    case 'UNKNOWN': await deliver('mock-pay', { event_id: `EVT-PENDING-${ref}`, type: 'payment.unknown', occurred_at: now, data }); break;
  }
}

/** Status inquiry: deterministic mock returns the definitive result for an ambiguous intent. */
export async function inquirePayment(intentId: string) {
  const intent = await tx(null, (t) => t.one('SELECT * FROM payment_intents WHERE id=$1', [intentId]));
  if (!intent) fail('NOT_FOUND', 404);
  if (!['UNKNOWN', 'PENDING'].includes(intent.status)) return { status: intent.status, inquiry: 'NO_CHANGE' };
  const ref = intent.provider_intent_ref as string;
  const data = { provider_intent_ref: ref, provider_reference: `RCPT-${ref}`, amount_irr: String(intent.amount_irr), currency: 'IRR' };
  const r = await deliver('mock-pay', { event_id: `EVT-INQUIRY-${ref}`, type: 'payment.succeeded', occurred_at: new Date().toISOString(), data });
  return { inquiry: 'SUCCEEDED', ...r };
}

/** Replay the original provider event — demonstrates that duplicates have no economic effect. */
export async function replayPaymentEvent(intentId: string) {
  const intent = await tx(null, (t) => t.one('SELECT * FROM payment_intents WHERE id=$1', [intentId]));
  if (!intent) fail('NOT_FOUND', 404);
  const ref = intent.provider_intent_ref as string;
  const data = { provider_intent_ref: ref, provider_reference: `RCPT-${ref}`, amount_irr: String(intent.amount_irr), currency: 'IRR' };
  const evt = intent.status === 'SUCCEEDED' && scenarioOf(ref) === 'UNKNOWN' ? `EVT-INQUIRY-${ref}` : `EVT-${ref}`;
  return deliver('mock-pay', { event_id: evt, type: 'payment.succeeded', occurred_at: new Date().toISOString(), data });
}

export function newIntentRef(scenario: string) {
  const s = ({ success: 'SUCCESS', unknown: 'UNKNOWN', failed: 'FAILED', duplicate: 'DUPLICATE' } as Record<string, string>)[scenario] ?? 'SUCCESS';
  return `MOCK-${s}-${uuid().slice(0, 13)}`;
}

async function lockIntent(t: Q, ref: string) {
  const intent = await t.one('SELECT * FROM payment_intents WHERE model_id=$1 AND provider=$2 AND provider_intent_ref=$3 FOR UPDATE', [MODEL_ID, 'mock', ref]);
  if (!intent) fail('UNKNOWN_INTENT', 404);
  return intent;
}

async function unknownPayment(t: Q, data: any) {
  const intent = await lockIntent(t, data.provider_intent_ref);
  if (intent.status === 'PENDING') await t.q("UPDATE payment_intents SET status='UNKNOWN', version=version+1, updated_at=now() WHERE id=$1", [intent.id]);
  return { status: 'UNKNOWN' };
}

async function failPayment(t: Q, data: any) {
  const intent = await lockIntent(t, data.provider_intent_ref);
  if (intent.status === 'SUCCEEDED') return { status: 'SUCCEEDED', ignored: 'LATE_FAILURE_CANNOT_DOWNGRADE' };
  await t.q("UPDATE payment_intents SET status='FAILED', version=version+1, updated_at=now() WHERE id=$1", [intent.id]);
  if (intent.checkout_id) await t.q("UPDATE checkouts SET status='CONTRACT_READY', version=version+1, updated_at=now() WHERE id=$1 AND status='PAYMENT_PENDING'", [intent.checkout_id]);
  await outbox(t, 'payment_intent', intent.id, 'payment.failed.v1', { intent_id: intent.id });
  return { status: 'FAILED' };
}

/** Verified payment confirmation: one receipt per provider reference, allocation once, balanced journals. */
export async function confirmPayment(t: Q, data: any, effects: Effect[]) {
  const intent = await lockIntent(t, data.provider_intent_ref);
  const amount = big(data.amount_irr);
  if (data.currency !== 'IRR' || amount !== big(intent.amount_irr)) {
    await audit(t, null, 'payment.amount_mismatch', 'payment_intent', intent.id, data);
    return { status: 'REJECTED', reason: 'AMOUNT_OR_CURRENCY_MISMATCH' };
  }
  const dup = await t.one('SELECT id FROM payment_receipts WHERE model_id=$1 AND provider=$2 AND provider_reference=$3', [MODEL_ID, 'mock', data.provider_reference]);
  if (dup) return { status: 'DUPLICATE_RECEIPT', receipt_id: dup.id };
  const now = await clock(t);
  const receiptId = uuid();
  const applied = intent.status !== 'SUCCEEDED';
  await t.q(`INSERT INTO payment_receipts(id,model_id,intent_id,provider,provider_reference,amount_irr,received_at,status) VALUES ($1,$2,$3,'mock',$4,$5,$6,$7)`,
    [receiptId, MODEL_ID, intent.id, data.provider_reference, amount, iso(now), applied ? 'SUCCEEDED' : 'UNAPPLIED']);
  await t.q("UPDATE payment_intents SET status='SUCCEEDED', version=version+1, updated_at=now() WHERE id=$1", [intent.id]);
  if (!applied) return unapplied(t, intent, receiptId, amount, 'SECOND_RECEIPT_FOR_INTENT');
  switch (intent.purpose) {
    case 'ASSESSMENT_FEE': return confirmFee(t, intent, receiptId, amount);
    case 'FIRST_INSTALLMENT': return confirmFirstInstallment(t, intent, receiptId, amount);
    case 'INSTALLMENT': return confirmInstallment(t, intent, receiptId, amount);
  }
  return fail('UNSUPPORTED_PURPOSE', 400);
}

async function unapplied(t: Q, intent: any, receiptId: string, amount: bigint, reason: string) {
  await t.q("UPDATE payment_receipts SET status='UNAPPLIED', version=version+1, updated_at=now() WHERE id=$1", [receiptId]);
  await post(t, intent.creditor_id, `UNAPPLIED:${receiptId}`, 'PAYMENT_RECEIPT', receiptId, [{ code: 'CASH', debit: amount }, { code: 'UNAPPLIED_RECEIPTS', credit: amount }]);
  await outbox(t, 'payment_receipt', receiptId, 'payment.unapplied.v1', { reason, amount_irr: amount });
  const u = await t.one('SELECT user_id FROM customers WHERE id=$1', [intent.customer_id]);
  await notify(t, u!.user_id, `UNAPPLIED:${receiptId}`, 'unapplied_receipt', { reason });
  return { status: 'UNAPPLIED', receipt_id: receiptId, reason };
}

async function confirmFee(t: Q, intent: any, receiptId: string, amount: bigint) {
  const { paystar } = await parties(t);
  await post(t, paystar, `FEE:${receiptId}`, 'PAYMENT_RECEIPT', receiptId, [{ code: 'CASH', debit: amount }, { code: 'ASSESSMENT_REVENUE', credit: amount }]);
  const app = await t.one('SELECT * FROM applications WHERE id=$1 FOR UPDATE', [intent.application_id]);
  if (app?.status === 'FEE_PENDING') {
    await t.q("UPDATE applications SET status='ASSESSMENT_PENDING', version=version+1, updated_at=now() WHERE id=$1", [app.id]);
    await outbox(t, 'application', app.id, 'application.fee_paid.v1', { application_id: app.id });
  }
  return { status: 'SUCCEEDED', receipt_id: receiptId, purpose: 'ASSESSMENT_FEE' };
}

async function confirmFirstInstallment(t: Q, intent: any, receiptId: string, amount: bigint) {
  const now = await clock(t);
  const co = await t.one('SELECT * FROM checkouts WHERE id=$1 FOR UPDATE', [intent.checkout_id]);
  const order = await t.one('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [co.order_id]);
  const res = await t.one('SELECT * FROM reservations WHERE checkout_id=$1 FOR UPDATE', [co.id]);
  const expired = co.status !== 'PAYMENT_PENDING' || res?.status !== 'ACTIVE' || new Date(co.expires_at) <= now;
  if (expired) {
    if (res?.status === 'ACTIVE') {
      const { expireReservations } = await import('./services');
      await expireReservations(t);
    }
    return unapplied(t, intent, receiptId, amount, 'RESERVATION_EXPIRED_NO_REVIVAL');
  }
  const { bank, paystar } = await parties(t);
  const P = big(co.principal_irr), C = big(co.commission_irr);
  const q = co.quote_snapshot;
  const contract = await t.one("SELECT id FROM contracts WHERE checkout_id=$1 AND status='SIGNED'", [co.id]);
  if (!contract) fail('CONTRACT_NOT_SIGNED', 409);
  const purchaseId = uuid();
  await t.q(`INSERT INTO purchases(id,model_id,checkout_id,customer_id,business_id,credit_line_id,contract_id,originator_id,current_owner_id,principal_irr,commission_irr,status,service_status,confirmed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,'CONFIRMED','AWAITING_FUNDS',$11)`,
    [purchaseId, MODEL_ID, co.id, order.customer_id, order.business_id, co.credit_line_id, contract.id, bank, P, C, iso(now)]);
  const instIds: Record<number, string> = {};
  for (const i of q.installments) {
    instIds[i.sequence] = uuid();
    await t.q(`INSERT INTO installments(id,model_id,purchase_id,sequence,due_at,due_local_date,principal_irr,commission_irr,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'SCHEDULED')`,
      [instIds[i.sequence], MODEL_ID, purchaseId, i.sequence, i.due_at, i.due_local_date, big(i.principal_irr), big(i.commission_irr)]);
  }
  for (const seq of q.installments.slice(1).map((x: any) => x.sequence)) await t.q('UPDATE checks SET purchase_id=$2, installment_id=$3, version=version+1, updated_at=now() WHERE checkout_id=$1 AND expected_installment_sequence=$4 AND status=\'IN_CUSTODY\'', [co.id, purchaseId, instIds[seq], seq]);
  await t.q("UPDATE reservations SET status='CONSUMED', version=version+1, updated_at=now() WHERE id=$1", [res.id]);
  await t.q('UPDATE credit_lines SET reserved_principal_irr=reserved_principal_irr-$2, outstanding_principal_irr=outstanding_principal_irr+$2, version=version+1, updated_at=now() WHERE id=$1', [co.credit_line_id, P]);
  await t.q("UPDATE exposure_buckets SET reserved_irr=reserved_irr-$2, outstanding_irr=outstanding_irr+$2, version=version+1, updated_at=now() WHERE model_id=$1 AND ((scope_type='PROGRAM' AND scope_key='ALL') OR (scope_type='CLINIC' AND scope_key=$3))", [MODEL_ID, P, order.business_id]);
  // Origination books in the bank mirror: the customer debt is a bank asset from inception.
  await post(t, bank, `ORIGINATE:${purchaseId}`, 'PURCHASE', purchaseId, [{ code: 'CUSTOMER_PRINCIPAL', debit: P }, { code: 'CLINIC_PAYABLE', credit: P }]);
  await post(t, bank, `COMMISSION:${purchaseId}`, 'PURCHASE', purchaseId, [{ code: 'CUSTOMER_COMMISSION', debit: C }, { code: 'DEFERRED_COMMISSION', credit: C }]);
  const alloc = await allocateAndPost(t, intent, purchaseId, receiptId, amount, true);
  await t.q('INSERT INTO ownership_history(model_id,purchase_id,owner_id,valid_from,evidence_hash) VALUES ($1,$2,$3,$4,$5)', [MODEL_ID, purchaseId, bank, iso(now), sha256(`ORIGINATION:${purchaseId}:${contract.id}`)]);
  const settleDate = nextBusinessDate(tehranIso(now), { holidays: content().calendar.mock_holidays });
  const settlementId = uuid();
  await t.q(`INSERT INTO settlements(id,model_id,purchase_id,from_party_id,to_party_id,kind,amount_irr,due_at,status) VALUES ($1,$2,$3,$4,$5,'CLINIC_PAYOUT',$6,$7,'QUEUED')`,
    [settlementId, MODEL_ID, purchaseId, bank, order.business_id, P, `${settleDate}T10:30:00Z`]);
  const p1 = alloc.principalReleased;
  await t.q(`INSERT INTO bank_instructions(model_id,bank_id,application_id,purchase_id,instruction_type,external_reference,status,expected_balance_irr,payload_hash)
     VALUES ($1,$2,(SELECT application_id FROM credit_lines WHERE id=$3),$4,'CLINIC_DISBURSEMENT',$5,'SUBMITTED',$6,$7)`,
    [MODEL_ID, bank, co.credit_line_id, purchaseId, `PS-DRAW-${purchaseId.slice(0, 8)}`, P - p1, sha256(JSON.stringify({ purchaseId, P: String(P), to: order.business_id }))]);
  const d = new Date(now); const ps = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); const pe = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  await t.q(`INSERT INTO invoices(model_id,payer_id,payee_id,purchase_id,invoice_type,net_irr,period_start,period_end,due_at,status) VALUES ($1,$2,$3,$4,'BANK_ORIGINATION_SERVICE',$5,$6,$7,$8,'DRAFT')`,
    [MODEL_ID, bank, paystar, purchaseId, roundHalfUp((P - p1) * 100n, 10000n), ps.toISOString().slice(0, 10), pe.toISOString().slice(0, 10), new Date(+pe + 7 * 86400000 + 30600000).toISOString()]);
  await t.q(`INSERT INTO servicing_mandates(model_id,creditor_id,servicer_id,purchase_id,valid_from,valid_until,payment_account_token,permissions,contract_hash) VALUES ($1,$2,$3,$4,$5,$6,'MOCK-BANK-COLLECTION',$7,$8)`,
    [MODEL_ID, bank, paystar, purchaseId, iso(now), q.installments[q.installments.length - 1].due_at.replace(/^(\d{4})/, (y: string) => String(Number(y) + 1)), JSON.stringify({ reminders: true, soft_collection_until_dpd: 29, legal: false, payment_interface: true }), sha256('MANDATE:' + purchaseId)]);
  await t.q("UPDATE payment_intents SET purchase_id=$2, owner_epoch=1, version=version+1, updated_at=now() WHERE id=$1", [intent.id, purchaseId]);
  await t.q("UPDATE checkouts SET status='CONFIRMED', version=version+1, updated_at=now() WHERE id=$1", [co.id]);
  await t.q("UPDATE orders SET status='CONFIRMED', version=version+1, updated_at=now() WHERE id=$1", [order.id]);
  await outbox(t, 'purchase', purchaseId, 'purchase.confirmed.v1', { purchase_id: purchaseId, principal_irr: P, creditor_id: bank });
  const u = await t.one('SELECT user_id FROM customers WHERE id=$1', [order.customer_id]);
  await notify(t, u!.user_id, `PURCHASE:${purchaseId}`, 'status_changed', { purchase_id: purchaseId });
  return { status: 'SUCCEEDED', purchase_id: purchaseId, receipt_id: receiptId, settlement_id: settlementId, principal_released: p1 };
}

async function confirmInstallment(t: Q, intent: any, receiptId: string, amount: bigint) {
  const r = await allocateAndPost(t, intent, intent.purchase_id, receiptId, amount, false);
  return { status: 'SUCCEEDED', purchase_id: intent.purchase_id, receipt_id: receiptId, principal_released: r.principalReleased, unapplied: r.unapplied };
}

/** Allocate earliest-due first: principal → commission → penalty. Releases only principal actually allocated. */
async function allocateAndPost(t: Q, intent: any, purchaseId: string, receiptId: string, amount: bigint, firstOnly: boolean) {
  const purchase = await t.one('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [purchaseId]);
  const rows = (await installments(t, purchaseId)).filter((i) => (firstOnly ? i.sequence === 1 : true));
  for (const i of rows) await t.q('SELECT id FROM installments WHERE id=$1 FOR UPDATE', [i.id]);
  const owed = rows.map((i) => ({ id: i.id, dueAt: new Date(i.due_at).toISOString(), sequence: i.sequence, ...residual(i) }));
  const plan = allocatePayment(amount, owed);
  if (firstOnly && plan.unapplied !== 0n) fail('FIRST_INSTALLMENT_MUST_BE_EXACT', 422);
  const comp: Record<string, string> = { principal: 'PRINCIPAL', commission: 'COMMISSION', penalty: 'PENALTY' };
  let p = 0n, c = 0n;
  for (const a of plan.allocations) {
    await t.q('INSERT INTO payment_allocations(model_id,receipt_id,installment_id,component,amount_irr) VALUES ($1,$2,$3,$4,$5)', [MODEL_ID, receiptId, a.installmentId, comp[a.component], a.amount]);
    await t.q(`UPDATE installments SET ${a.component}_paid_irr=${a.component}_paid_irr+$2, version=version+1, updated_at=now() WHERE id=$1`, [a.installmentId, a.amount]);
    if (a.component === 'principal') p += a.amount; else if (a.component === 'commission') c += a.amount;
  }
  const book = purchase.current_owner_id;
  await post(t, book, `RECEIPT:${receiptId}`, 'PAYMENT_RECEIPT', receiptId, [
    { code: 'CASH', debit: amount - plan.unapplied }, { code: 'CUSTOMER_PRINCIPAL', credit: p }, { code: 'CUSTOMER_COMMISSION', credit: c }]);
  if (c > 0n) await post(t, book, `RECOGNIZE:${receiptId}`, 'PAYMENT_RECEIPT', receiptId, [{ code: 'DEFERRED_COMMISSION', debit: c }, { code: 'COMMISSION_REVENUE', credit: c }]);
  if (plan.unapplied > 0n) await post(t, book, `UNAPPLIED:${receiptId}`, 'PAYMENT_RECEIPT', receiptId, [{ code: 'CASH', debit: plan.unapplied }, { code: 'UNAPPLIED_RECEIPTS', credit: plan.unapplied }]);
  if (!firstOnly) await releaseOutstanding(t, purchase.credit_line_id, purchase.business_id, p);
  else await releaseOutstanding(t, purchase.credit_line_id, purchase.business_id, p);
  await refreshInstallmentStatuses(t, purchaseId);
  // Checks for fully settled installments move to release; bank evidence completes release.
  for (const i of await installments(t, purchaseId)) {
    if (residual(i).total === 0n) await t.q("UPDATE checks SET status='RELEASE_PENDING', version=version+1, updated_at=now() WHERE installment_id=$1 AND status='IN_CUSTODY'", [i.id]);
  }
  const remaining = sum((await installments(t, purchaseId)).map((i) => residual(i).total));
  if (remaining === 0n && purchase.status === 'CONFIRMED') await t.q("UPDATE purchases SET status='SETTLED', version=version+1, updated_at=now() WHERE id=$1", [purchaseId]);
  await cureHolds(t);
  if (remaining === 0n || (await t.one("SELECT 1 FROM installments WHERE purchase_id=$1 AND status='OVERDUE'", [purchaseId])) === undefined)
    await t.q("UPDATE collection_cases SET stage='CLOSED', dpd=0, version=version+1, updated_at=now() WHERE purchase_id=$1 AND stage IN ('MONITORING','SOFT')", [purchaseId]);
  await outbox(t, 'payment_receipt', receiptId, 'payment.allocated.v1', { purchase_id: purchaseId, principal_irr: p, commission_irr: c });
  if (plan.unapplied > 0n) await t.q("UPDATE payment_receipts SET status='PARTIALLY_UNAPPLIED', version=version+1, updated_at=now() WHERE id=$1", [receiptId]);
  return { principalReleased: p, commission: c, unapplied: plan.unapplied };
}

// ------------------------------------------------------------------ payouts (clinic disbursement, wallet withdrawal)
export async function mockPayoutProvider(kind: 'CLINIC_PAYOUT' | 'WITHDRAWAL', reference: string, scenario: string) {
  const type = scenario === 'failed' ? 'payout.failed' : scenario === 'unknown' ? 'payout.unknown' : 'payout.confirmed';
  return deliver('mock-bank', { event_id: `EVT-${type}-${reference}`, type, occurred_at: new Date().toISOString(), data: { kind, reference } });
}
export async function inquirePayout(kind: 'CLINIC_PAYOUT' | 'WITHDRAWAL', reference: string) {
  return deliver('mock-bank', { event_id: `EVT-INQUIRY-${reference}`, type: 'payout.confirmed', occurred_at: new Date().toISOString(), data: { kind, reference } });
}

async function payoutResult(t: Q, data: any, status: 'CONFIRMED' | 'FAILED' | 'UNKNOWN') {
  const now = await clock(t);
  if (data.kind === 'CLINIC_PAYOUT') {
    const s = await t.one('SELECT * FROM settlements WHERE model_id=$1 AND external_reference=$2 FOR UPDATE', [MODEL_ID, data.reference]);
    if (!s) fail('UNKNOWN_SETTLEMENT', 404);
    if (s.status === 'CONFIRMED') return { status: 'CONFIRMED', duplicate: true };
    if (status === 'UNKNOWN') { await t.q("UPDATE settlements SET status='UNKNOWN', version=version+1, updated_at=now() WHERE id=$1", [s.id]); return { status }; }
    if (status === 'FAILED') { await t.q("UPDATE settlements SET status='FAILED', version=version+1, updated_at=now() WHERE id=$1", [s.id]); return { status }; }
    await t.q("UPDATE settlements SET status='CONFIRMED', confirmed_at=$2, version=version+1, updated_at=now() WHERE id=$1", [s.id, iso(now)]);
    await post(t, s.from_party_id, `CLINIC_PAID:${s.id}`, 'SETTLEMENT', s.id, [{ code: 'CLINIC_PAYABLE', debit: big(s.amount_irr) }, { code: 'CASH', credit: big(s.amount_irr) }]);
    await t.q("UPDATE purchases SET service_status='READY_FOR_SERVICE', version=version+1, updated_at=now() WHERE id=$1 AND service_status='AWAITING_FUNDS'", [s.purchase_id]);
    await t.q("UPDATE bank_instructions SET status='CONFIRMED', acknowledged_balance_irr=expected_balance_irr, acknowledged_at=$2, version=version+1, updated_at=now() WHERE purchase_id=$1 AND instruction_type='CLINIC_DISBURSEMENT'", [s.purchase_id, iso(now)]);
    await outbox(t, 'settlement', s.id, 'settlement.confirmed.v1', { settlement_id: s.id, purchase_id: s.purchase_id });
    return { status };
  }
  const w = await t.one('SELECT * FROM withdrawals WHERE model_id=$1 AND provider_reference=$2 FOR UPDATE', [MODEL_ID, data.reference]);
  if (!w) fail('UNKNOWN_WITHDRAWAL', 404);
  if (['CONFIRMED', 'FAILED'].includes(w.status)) return { status: w.status, duplicate: true };
  if (status === 'UNKNOWN') { await t.q("UPDATE withdrawals SET status='UNKNOWN', version=version+1, updated_at=now() WHERE id=$1", [w.id]); return { status }; }
  const amt = big(w.amount_irr);
  if (status === 'FAILED') {
    await t.q("UPDATE withdrawals SET status='FAILED', version=version+1, updated_at=now() WHERE id=$1", [w.id]);
    await t.q('UPDATE wallets SET held_irr=held_irr-$2, version=version+1, updated_at=now() WHERE id=$1', [w.wallet_id, amt]);
    return { status };
  }
  const { paystar } = await parties(t);
  const j = await post(t, paystar, `WITHDRAW:${w.id}`, 'WITHDRAWAL', w.id, [{ code: 'WALLET_LIABILITY', debit: amt }, { code: 'WALLET_CASH', credit: amt }]);
  await t.q("UPDATE withdrawals SET status='CONFIRMED', confirmed_at=$2, version=version+1, updated_at=now() WHERE id=$1", [w.id, iso(now)]);
  await t.q('UPDATE wallets SET held_irr=held_irr-$2, funded_irr=funded_irr-$2, liability_irr=liability_irr-$2, version=version+1, updated_at=now() WHERE id=$1', [w.wallet_id, amt]);
  await t.q(`INSERT INTO wallet_entries(model_id,wallet_id,entry_type,amount_irr,event_key,journal_id) VALUES ($1,$2,'WITHDRAWN',$3,$4,$5)`, [MODEL_ID, w.wallet_id, amt, `WITHDRAW:${w.id}`, j.id]);
  await outbox(t, 'withdrawal', w.id, 'wallet.withdrawal_confirmed.v1', { withdrawal_id: w.id });
  return { status };
}

export { AppError, addMinutes };
