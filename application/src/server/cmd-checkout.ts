/** Clinic order → reservation/quote → bank contract + checks → first payment → bank payout → service. */
import { MODEL_ID, Q } from './db';
import { Actor, parseMoney, addMinutes, audit, big, clock, fail, iso, outbox, parties, sha256, sum, tehranIso, uuid } from './core';
import { affordability, monthlyDueDates, quoteN } from './kit';
import { inquirePayment, mockPaymentProvider, newIntentRef, replayPaymentEvent } from './payments';
import { installments, lineState, residual } from './services';
import type { Ctx } from './cmd-application';

const PILOT_CLINIC_CAP = 3000000000n;

/** Customers a clinic may address: those referred by its own links (privacy-scoped). */
export async function clinicCustomers(t: Q, businessId: string) {
  return t.q(`SELECT DISTINCT cu.id, u.display_name, cl.id AS credit_line_id, cl.status AS line_status
      FROM applications a JOIN referrals r ON r.id=a.referral_id JOIN customers cu ON cu.id=a.customer_id JOIN users u ON u.id=cu.user_id
      LEFT JOIN credit_lines cl ON cl.customer_id=cu.id AND cl.status IN ('ACTIVE','HELD')
     WHERE r.business_id=$1 ORDER BY u.display_name`, [businessId]);
}

export async function createOrder(t: Q, actor: Actor, input: any) {
  const now = await clock(t);
  const state = await t.one('SELECT originations_paused, pause_reason FROM app_demo_state WHERE id=1');
  if (state.originations_paused) fail('ORIGINATIONS_PAUSED', 422, `ایجاد خرید جدید موقتاً متوقف است: ${state.pause_reason ?? ''}`);
  const clinic = await t.one('SELECT * FROM organizations WHERE id=$1', [actor.orgId]);
  if (!clinic || clinic.party_type !== 'CLINIC' || clinic.status !== 'ACTIVE') fail('CLINIC_NOT_ELIGIBLE', 422, 'کلینیک برای ایجاد خرید فعال نیست.');
  const allowed = await clinicCustomers(t, clinic.id);
  const customer = allowed.find((c: any) => c.id === input.customer_id) as any;
  if (!customer) fail('NOT_FOUND', 404, 'مشتری معرفی‌شده توسط این کلینیک یافت نشد.');
  const item = await t.one('SELECT * FROM catalog_items WHERE id=$1 AND business_id=$2', [input.catalog_item_id, clinic.id]);
  if (!item || !item.available) fail('ITEM_UNAVAILABLE', 422, 'خدمت انتخاب‌شده در دسترس نیست.', [{ field: 'catalog_item_id', code: 'UNAVAILABLE' }]);
  if (+now - +new Date(item.source_updated_at) > 24 * 3600000) fail('STALE_PRICE', 422, 'قیمت کاتالوگ بیش از ۲۴ ساعت به‌روز نشده است.');
  const total = big(item.price_irr);
  const P = String(input.financed_principal_irr ?? '').trim() ? parseMoney(input.financed_principal_irr, 'financed_principal_irr') : total;
  const cash = total - P;
  if (P < 10000000n) fail('BELOW_MINIMUM', 422, 'حداقل مبلغ اقساطی ۱ میلیون تومان است.', [{ field: 'financed_principal_irr', code: 'MIN' }]);
  if (P > total || P % 10n !== 0n) fail('INVALID_AMOUNT', 422, 'مبلغ اقساطی نامعتبر است.', [{ field: 'financed_principal_irr', code: 'INVALID' }]);
  const lineId = customer.credit_line_id;
  if (!lineId) fail('NO_ACTIVE_LINE', 422, 'مشتری اعتبار فعال ندارد.');
  await t.q('SELECT id FROM customers WHERE id=$1 FOR UPDATE', [customer.id]);
  await t.q('SELECT id FROM credit_lines WHERE id=$1 FOR UPDATE', [lineId]);
  const ls = (await lineState(t, lineId))!;
  if (ls.line.status !== 'ACTIVE' || ls.expired) fail('LINE_NOT_SPENDABLE', 422, ls.blockedReasons.join('؛ ') || 'اعتبار قابل مصرف نیست.');
  if (ls.overdue) fail('OVERDUE_DEBT', 422, 'بدهی سررسید گذشته مانع خرید جدید است.');
  const assess = await t.one('SELECT assessed_at FROM assessments WHERE application_id=$1 ORDER BY assessed_at DESC LIMIT 1', [ls.line.application_id]);
  if (!assess || +now - +new Date(assess.assessed_at) > 30 * 86400000) fail('EVIDENCE_EXPIRED', 422, 'اعتبارسنجی بیش از ۳۰ روز پیش انجام شده؛ تمدید لازم است.');
  if (P > ls.spendable) fail('INSUFFICIENT_CREDIT', 422, undefined, [{ field: 'financed_principal_irr', code: 'INSUFFICIENT_CREDIT' }]);
  // Combined monthly affordability over every affected Jalali month.
  const cust = await t.one('SELECT * FROM customers WHERE id=$1', [customer.id]);
  const n = Number(ls.line.installment_count ?? 4);
  const q = quoteN(P, n, 1200n);
  const dates = monthlyDueDates(tehranIso(now), n);
  const existing: Record<string, bigint> = {};
  const rows = await t.q(`SELECT i.* FROM installments i JOIN purchases p ON p.id=i.purchase_id WHERE p.customer_id=$1 AND i.status<>'SUPERSEDED'`, [customer.id]);
  for (const i of rows) { const k = i.due_local_date.slice(0, 7); existing[k] = (existing[k] ?? 0n) + residual(i as any).total; }
  const proposed: Record<string, bigint> = {};
  q.installments.forEach((x, idx) => { const k = dates[idx].jalali.slice(0, 7); proposed[k] = (proposed[k] ?? 0n) + x.total; });
  const aff = affordability({ income: big(cust.verified_monthly_income_irr), externalObligations: big(cust.external_monthly_obligations_irr), existingByMonth: existing, proposedByMonth: proposed });
  if (!aff.allowed) fail('AFFORDABILITY_EXCEEDED', 422, undefined, aff.breaches.map((m: string) => ({ field: m, code: 'AFFORDABILITY_EXCEEDED' })));
  // Program and selling-clinic exposure (outstanding + reservations), locked in stable order.
  await t.q(`INSERT INTO exposure_buckets(model_id,scope_type,scope_key,limit_irr) VALUES ($1,'CLINIC',$2,$3) ON CONFLICT (model_id,scope_type,scope_key) DO NOTHING`, [MODEL_ID, clinic.id, PILOT_CLINIC_CAP]);
  const buckets = await t.q("SELECT * FROM exposure_buckets WHERE model_id=$1 AND ((scope_type='PROGRAM' AND scope_key='ALL') OR (scope_type='CLINIC' AND scope_key=$2)) ORDER BY id FOR UPDATE", [MODEL_ID, clinic.id]);
  for (const b of buckets) if (big(b.outstanding_irr) + big(b.reserved_irr) + P > big(b.limit_irr)) fail('EXPOSURE_CAP', 422, `سقف ریسک ${b.scope_type === 'PROGRAM' ? 'برنامه' : 'کلینیک'} اجازه این خرید را نمی‌دهد.`);
  const orderId = uuid(), checkoutId = uuid();
  const ref = String(input.external_reference || `ORD-${orderId.slice(0, 8)}`);
  await t.q(`INSERT INTO orders(id,model_id,tenant_id,business_id,customer_id,external_reference,service_total_irr,financed_principal_irr,cash_contribution_irr,line_items,status) VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,'CHECKOUT_SENT')`,
    [orderId, MODEL_ID, clinic.id, customer.id, ref, total, P, cash, JSON.stringify([{ sku: item.external_sku, title: item.title, quantity: 1, principal_irr: String(P), cash_irr: String(cash) }])]);
  const { bank } = await parties(t);
  const snapshot = {
    principal_irr: String(P), commission_irr: String(q.commission), total_irr: String(q.total), commission_bps: 1200, service_total_irr: String(total), cash_contribution_irr: String(cash),
    creditor_id: bank, check_beneficiary_id: bank, clinic_id: clinic.id, service: item.title, assessment_fee_irr: '500000', policy: 'BASELINE v1 (simulation)',
    installments: q.installments.map((x, i) => ({ sequence: x.sequence, principal_irr: String(x.principal), commission_irr: String(x.commission), total_irr: String(x.total), due_at: dates[i].dueAt, due_local_date: dates[i].jalali, due_gregorian: dates[i].gregorian })),
  };
  const expires = addMinutes(now, 15);
  await t.q(`INSERT INTO checkouts(id,model_id,order_id,credit_line_id,principal_irr,commission_irr,quote_hash,quote_snapshot,status,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'RESERVED',$9)`,
    [checkoutId, MODEL_ID, orderId, lineId, P, q.commission, sha256(JSON.stringify(snapshot)), JSON.stringify(snapshot), iso(expires)]);
  await t.q(`INSERT INTO reservations(model_id,checkout_id,credit_line_id,principal_irr,status,expires_at) VALUES ($1,$2,$3,$4,'ACTIVE',$5)`, [MODEL_ID, checkoutId, lineId, P, iso(expires)]);
  await t.q('UPDATE credit_lines SET reserved_principal_irr=reserved_principal_irr+$2, version=version+1, updated_at=now() WHERE id=$1', [lineId, P]);
  await t.q("UPDATE exposure_buckets SET reserved_irr=reserved_irr+$2, version=version+1, updated_at=now() WHERE model_id=$1 AND ((scope_type='PROGRAM' AND scope_key='ALL') OR (scope_type='CLINIC' AND scope_key=$3))", [MODEL_ID, P, clinic.id]);
  await outbox(t, 'checkout', checkoutId, 'credit.reserved.v1', { checkout_id: checkoutId, principal_irr: P });
  return { order_id: orderId, checkout_id: checkoutId, status: 'RESERVED', expires_at: iso(expires), quote: snapshot };
}

async function ownCheckout(t: Q, actor: Actor, id: string) {
  const co = await t.one('SELECT c.*, o.customer_id, o.business_id FROM checkouts c JOIN orders o ON o.id=c.order_id WHERE c.id=$1', [id]);
  if (!co) fail('NOT_FOUND', 404);
  if (actor.role === 'customer' && co.customer_id !== actor.customerId) fail('NOT_FOUND', 404);
  if (actor.role === 'business-admin' && co.business_id !== actor.orgId) fail('NOT_FOUND', 404);
  await t.q('SELECT id FROM checkouts WHERE id=$1 FOR UPDATE', [id]);
  const now = await clock(t);
  if (['RESERVED', 'CONTRACT_READY'].includes(co.status) && new Date(co.expires_at) <= now) fail('CHECKOUT_EXPIRED', 409, 'مهلت ۱۵ دقیقه‌ای پیش‌فاکتور تمام شده است؛ پیش‌فاکتور جدید لازم است.');
  return co;
}

async function maybeReady(t: Q, checkoutId: string) {
  const co = await t.one('SELECT quote_snapshot FROM checkouts WHERE id=$1', [checkoutId]);
  const needed = co.quote_snapshot.installments.length - 1;
  const signed = await t.one("SELECT id FROM contracts WHERE checkout_id=$1 AND status='SIGNED'", [checkoutId]);
  const n = await t.one<{ n: number }>("SELECT count(*)::int n FROM checks WHERE checkout_id=$1 AND status='IN_CUSTODY'", [checkoutId]);
  if (signed && n!.n === needed) await t.q("UPDATE checkouts SET status='CONTRACT_READY', version=version+1, updated_at=now() WHERE id=$1 AND status='RESERVED'", [checkoutId]);
}

export async function signContract(t: Q, actor: Actor, input: any) {
  const co = await ownCheckout(t, actor, input.checkout_id);
  if (co.status !== 'RESERVED') fail('INVALID_TRANSITION', 409);
  if (!input.accept) fail('SIGNATURE_REQUIRED', 422, 'برای امضا، متن قرارداد را تأیید کنید.', [{ field: 'accept', code: 'REQUIRED' }]);
  if (await t.one("SELECT id FROM contracts WHERE checkout_id=$1 AND status='SIGNED'", [co.id])) return { status: 'ALREADY_SIGNED' };
  const now = await clock(t);
  const line = await t.one('SELECT * FROM credit_lines WHERE id=$1', [co.credit_line_id]);
  const policy = await t.one("SELECT id FROM policies WHERE status='APPROVED' ORDER BY policy_version DESC LIMIT 1");
  const terms = { ...co.quote_snapshot, contract: 'BANK_CUSTOMER_CREDIT', borrower: co.customer_id, lender: line.creditor_id, simulation: true };
  await t.q(`INSERT INTO contracts(model_id,application_id,checkout_id,creditor_id,policy_id,contract_type,document_hash,status,signed_at,signature_evidence,terms_snapshot) VALUES ($1,$2,$3,$4,$5,'BANK_CUSTOMER_CREDIT',$6,'SIGNED',$7,$8,$9)`,
    [MODEL_ID, line.application_id, co.id, line.creditor_id, policy.id, sha256(JSON.stringify(terms)), iso(now), JSON.stringify({ demo: true, quote_hash: co.quote_hash, signers: [co.customer_id, line.creditor_id] }), JSON.stringify(terms)]);
  await maybeReady(t, co.id);
  return { status: 'SIGNED', document_hash: sha256(JSON.stringify(terms)) };
}

/** Customer records three postdated checks payable to the bank; mock Sayad adapter verifies registration only. */
export async function registerChecks(t: Q, actor: Actor, input: any) {
  const co = await ownCheckout(t, actor, input.checkout_id);
  if (co.status !== 'RESERVED') fail('INVALID_TRANSITION', 409);
  const now = await clock(t);
  const { bank } = await parties(t);
  const errs: { field: string; code: string }[] = [];
  const checks = input.checks as { sequence: number; sayad_id: string; amount_irr: string; beneficiary: string }[];
  for (const seq of co.quote_snapshot.installments.slice(1).map((x: any) => x.sequence)) {
    const inst = co.quote_snapshot.installments.find((x: any) => x.sequence === seq);
    const c = checks?.find((x) => Number(x.sequence) === seq);
    if (!c || !/^DEMO-SAYAD-[A-Z0-9-]{3,}$/i.test(String(c.sayad_id).trim())) { errs.push({ field: `check.${seq}.sayad_id`, code: 'INVALID' }); continue; }
    if (String(c.amount_irr).replace(/[,\s]/g, '') !== inst.total_irr) errs.push({ field: `check.${seq}.amount_irr`, code: 'AMOUNT_MISMATCH' });
    if (c.beneficiary !== bank) errs.push({ field: `check.${seq}.beneficiary`, code: 'CREDITOR_MISMATCH' });
  }
  if (errs.length) fail('CHECK_MISMATCH', 422, 'مشخصات چک (ذی‌نفع، مبلغ یا شناسه صیاد) با قرارداد تطبیق ندارد.', errs);
  for (const c of checks) {
    const seq = Number(c.sequence);
    const inst = co.quote_snapshot.installments.find((x: any) => x.sequence === seq);
    const existing = await t.one("SELECT id FROM checks WHERE checkout_id=$1 AND expected_installment_sequence=$2 AND status NOT IN ('RELEASED','VOIDED')", [co.id, seq]);
    if (existing) continue;
    const id = uuid();
    const token = String(c.sayad_id).trim().toUpperCase();
    if (await t.one('SELECT id FROM checks WHERE model_id=$1 AND sayad_id_token=$2', [MODEL_ID, token])) fail('DUPLICATE_SAYAD', 409, 'این شناسه صیاد قبلاً ثبت شده است.', [{ field: `check.${seq}.sayad_id`, code: 'DUPLICATE' }]);
    await t.q(`INSERT INTO checks(id,model_id,checkout_id,expected_installment_sequence,sayad_id_token,issuer_customer_id,beneficiary_id,custodian_id,amount_irr,maturity_date,status,evidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,'REGISTERED',$10)`,
      [id, MODEL_ID, co.id, seq, token, co.customer_id, bank, big(inst.total_irr), inst.due_gregorian, JSON.stringify({ registered: true, accepted: false, demo: true, note: 'ثبت در صیاد شبیه‌سازی شده است' })]);
    await t.q(`INSERT INTO check_events(model_id,check_id,event_type,to_holder_id,external_reference,effective_at,evidence_hash,actor_id) VALUES ($1,$2,'REGISTERED',$3,$4,$5,$6,$7)`,
      [MODEL_ID, id, bank, `MOCK-SAYAD-REG-${token}`, iso(now), sha256(token), actor.userId]);
  }
  return { status: 'REGISTERED', awaiting: 'BANK_ACCEPTANCE' };
}

/** Bank accepts registered checks into its custody (bank-only evidence). */
export async function acceptChecks(t: Q, actor: Actor, input: any) {
  const now = await clock(t);
  const rows = await t.q("SELECT * FROM checks WHERE checkout_id=$1 AND status='REGISTERED' FOR UPDATE", [input.checkout_id]);
  if (!rows.length) fail('INVALID_TRANSITION', 409, 'چک ثبت‌شده‌ای در انتظار پذیرش نیست.');
  for (const c of rows) {
    if (c.beneficiary_id !== actor.orgId) fail('CREDITOR_MISMATCH', 422);
    await t.q("UPDATE checks SET status='IN_CUSTODY', custodian_id=$2, evidence=evidence || '{\"accepted\":true}'::jsonb, version=version+1, updated_at=now() WHERE id=$1", [c.id, actor.orgId]);
    for (const ev of ['ACCEPTED', 'IN_CUSTODY'])
      await t.q(`INSERT INTO check_events(model_id,check_id,event_type,from_holder_id,to_holder_id,external_reference,effective_at,evidence_hash,actor_id) VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8)`,
        [MODEL_ID, c.id, ev, actor.orgId, `MOCK-BANK-${ev}-${c.sayad_id_token}`, iso(now), sha256(ev + c.id), actor.userId]);
  }
  await maybeReady(t, input.checkout_id);
  return { accepted: rows.length };
}

export async function cancelCheckout(t: Q, actor: Actor, input: any) {
  const co = await t.one('SELECT c.*, o.customer_id, o.business_id FROM checkouts c JOIN orders o ON o.id=c.order_id WHERE c.id=$1 FOR UPDATE OF c', [input.checkout_id]);
  if (!co || (actor.role === 'customer' && co.customer_id !== actor.customerId) || (actor.role === 'business-admin' && co.business_id !== actor.orgId)) fail('NOT_FOUND', 404);
  if (!['RESERVED', 'CONTRACT_READY'].includes(co.status)) fail('INVALID_TRANSITION', 409, co.status === 'PAYMENT_PENDING' ? 'پرداخت در انتظار نتیجه است؛ ابتدا وضعیت آن را استعلام کنید.' : undefined);
  const { releaseReservedExposure } = await import('./services');
  await t.q("UPDATE checkouts SET status='CANCELLED', version=version+1, updated_at=now() WHERE id=$1", [co.id]);
  await t.q("UPDATE reservations SET status='RELEASED', version=version+1, updated_at=now() WHERE checkout_id=$1 AND status='ACTIVE'", [co.id]);
  await releaseReservedExposure(t, co.credit_line_id, co.business_id, big(co.principal_irr));
  await t.q("UPDATE orders SET status='CANCELLED', version=version+1, updated_at=now() WHERE id=$1", [co.order_id]);
  await t.q("UPDATE checks SET status='RELEASE_PENDING', version=version+1, updated_at=now() WHERE checkout_id=$1 AND status IN ('REGISTERED','IN_CUSTODY')", [co.id]);
  return { status: 'CANCELLED' };
}

/** Start a payment intent to the bank collection route; provider result arrives as a signed callback. */
export async function startPayment(t: Q, actor: Actor, input: any, ctx: Ctx) {
  const now = await clock(t);
  const { bank } = await parties(t);
  const id = uuid();
  if (input.checkout_id) {
    const co = await ownCheckout(t, actor, input.checkout_id);
    if (co.status !== 'CONTRACT_READY') fail('INVALID_TRANSITION', 409, co.status === 'RESERVED' ? 'قرارداد و پذیرش همه چک‌ها توسط بانک لازم است.' : undefined);
    const open = await t.one("SELECT id FROM payment_intents WHERE checkout_id=$1 AND status IN ('PENDING','UNKNOWN')", [co.id]);
    if (open) fail('EXTERNAL_PENDING', 409);
    const first = co.quote_snapshot.installments[0];
    await t.q(`INSERT INTO payment_intents(id,model_id,customer_id,checkout_id,application_id,creditor_id,purpose,amount_irr,provider,provider_intent_ref,status,expires_at)
       VALUES ($1,$2,$3,$4,(SELECT application_id FROM credit_lines WHERE id=$5),$6,'FIRST_INSTALLMENT',$7,'mock',$8,'PENDING',$9)`,
      [id, MODEL_ID, co.customer_id, co.id, co.credit_line_id, bank, big(first.total_irr), newIntentRef(input.scenario), co.expires_at]);
    await t.q("UPDATE checkouts SET status='PAYMENT_PENDING', version=version+1, updated_at=now() WHERE id=$1", [co.id]);
    ctx.effects.push(() => mockPaymentProvider(id));
    return { intent_id: id, amount_irr: big(first.total_irr), creditor_id: bank, destination: 'BANK_COLLECTION_ACCOUNT' };
  }
  const p = await t.one('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [input.purchase_id]);
  if (!p || p.customer_id !== actor.customerId) fail('NOT_FOUND', 404);
  if (await t.one("SELECT id FROM payment_intents WHERE purchase_id=$1 AND purpose='INSTALLMENT' AND status IN ('PENDING','UNKNOWN')", [p.id])) fail('EXTERNAL_PENDING', 409);
  const open = (await installments(t, p.id)).filter((i) => residual(i).total > 0n);
  if (!open.length) fail('NOTHING_DUE', 422, 'مانده‌ای برای پرداخت وجود ندارد.');
  let count = input.payoff ? open.length : Number(input.count ?? 1);
  if (!(count >= 1 && count <= open.length)) fail('INVALID_SELECTION', 422);
  // Selected installments are always the earliest-due ones (allocation order).
  const amount = sum(open.slice(0, count).map((i) => residual(i).total));
  await t.q(`INSERT INTO payment_intents(id,model_id,customer_id,purchase_id,creditor_id,purpose,amount_irr,provider,provider_intent_ref,status,owner_epoch,expires_at)
     VALUES ($1,$2,$3,$4,$5,'INSTALLMENT',$6,'mock',$7,'PENDING',$8,$9)`,
    [id, MODEL_ID, p.customer_id, p.id, p.current_owner_id, amount, newIntentRef(input.scenario), p.owner_epoch, iso(addMinutes(now, 60 * 24))]);
  ctx.effects.push(() => mockPaymentProvider(id));
  return { intent_id: id, amount_irr: amount, creditor_id: p.current_owner_id, installments: count };
}

export async function inquire(t: Q, actor: Actor, input: any, ctx: Ctx) {
  const intent = await t.one('SELECT * FROM payment_intents WHERE id=$1', [input.intent_id]);
  if (!intent || (actor.role === 'customer' && intent.customer_id !== actor.customerId)) fail('NOT_FOUND', 404);
  if (!['UNKNOWN', 'PENDING'].includes(intent.status)) return { status: intent.status, inquiry: 'NO_CHANGE' };
  ctx.effects.push(async () => { await inquirePayment(intent.id); });
  await audit(t, actor, 'payment.inquiry', 'payment_intent', intent.id);
  return { status: 'INQUIRY_SENT' };
}

export async function replay(t: Q, actor: Actor, input: any, ctx: Ctx) {
  const intent = await t.one('SELECT * FROM payment_intents WHERE id=$1', [input.intent_id]);
  if (!intent) fail('NOT_FOUND', 404);
  if (intent.status !== 'SUCCEEDED') fail('INVALID_TRANSITION', 409, 'فقط رویداد پرداخت موفق قابل بازپخش است.');
  const before = await t.one('SELECT count(*)::int n FROM payment_receipts');
  ctx.effects.push(async () => { await replayPaymentEvent(intent.id); });
  return { replayed: true, receipts_before: before?.n };
}

export async function serviceStart(t: Q, actor: Actor, input: any) {
  const p = await t.one('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [input.purchase_id]);
  if (!p || p.business_id !== actor.orgId) fail('NOT_FOUND', 404);
  if (p.service_status !== 'READY_FOR_SERVICE') fail('SERVICE_NOT_FUNDED', 422, 'شروع خدمت فقط پس از تأیید واریز بانک به کلینیک مجاز است.');
  const now = await clock(t);
  await t.q("UPDATE purchases SET service_status='STARTED', service_evidence=service_evidence || $2::jsonb, version=version+1, updated_at=now() WHERE id=$1", [p.id, JSON.stringify({ started_at: iso(now), started_by: actor.userId })]);
  return { service_status: 'STARTED' };
}
export async function serviceComplete(t: Q, actor: Actor, input: any) {
  const p = await t.one('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [input.purchase_id]);
  if (!p || p.business_id !== actor.orgId) fail('NOT_FOUND', 404);
  if (p.service_status !== 'STARTED') fail('INVALID_TRANSITION', 409);
  const now = await clock(t);
  await t.q("UPDATE purchases SET service_status='COMPLETED', service_evidence=service_evidence || $2::jsonb, version=version+1, updated_at=now() WHERE id=$1", [p.id, JSON.stringify({ completed_at: iso(now), customer_acknowledged: false })]);
  return { service_status: 'COMPLETED', awaiting: 'CUSTOMER_ACKNOWLEDGEMENT' };
}
export async function serviceAcknowledge(t: Q, actor: Actor, input: any) {
  const p = await t.one('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [input.purchase_id]);
  if (!p || p.customer_id !== actor.customerId) fail('NOT_FOUND', 404);
  if (p.service_status !== 'COMPLETED') fail('INVALID_TRANSITION', 409);
  await t.q("UPDATE purchases SET service_evidence=service_evidence || '{\"customer_acknowledged\":true}'::jsonb, version=version+1, updated_at=now() WHERE id=$1", [p.id]);
  return { acknowledged: true };
}

/** Clinic creates a revocable referral link (30 days). Only the token hash is stored. */
export async function createReferral(t: Q, actor: Actor) {
  const now = await clock(t);
  const token = `DEMO-REF-${uuid().slice(0, 8).toUpperCase()}`;
  const id = uuid();
  await t.q(`INSERT INTO referrals(id,model_id,tenant_id,business_id,token_hash,expires_at) VALUES ($1,$2,$3,$3,$4,$5)`, [id, MODEL_ID, actor.orgId, sha256(token), iso(addMinutes(now, 30 * 1440))]);
  return { referral_id: id, token, url: `/r/${token}` };
}
export async function revokeReferral(t: Q, actor: Actor, input: any) {
  const r = await t.one('SELECT * FROM referrals WHERE id=$1 FOR UPDATE', [input.referral_id]);
  if (!r || r.business_id !== actor.orgId) fail('NOT_FOUND', 404);
  const now = await clock(t);
  await t.q('UPDATE referrals SET revoked_at=$2, version=version+1, updated_at=now() WHERE id=$1', [r.id, iso(now)]);
  return { revoked: true };
}

/** Resolve a referral token: seeded fixture token is stored verbatim, new tokens as SHA-256. */
export async function findReferral(t: Q, token: string) {
  return t.one(`SELECT r.*, o.name AS clinic, o.status AS clinic_status FROM referrals r JOIN organizations o ON o.id=r.business_id WHERE r.token_hash IN ($1,$2)`, [token, sha256(token)]);
}

/** Public registration from a valid referral: creates identity shell, draft application and refund wallet. */
export async function registerFromReferral(t: Q, input: any) {
  const ref = await findReferral(t, String(input.token ?? ''));
  const now = await clock(t);
  if (!ref || ref.revoked_at || new Date(ref.expires_at) <= now) fail('REFERRAL_INVALID', 422, 'لینک معرفی نامعتبر، منقضی یا لغوشده است.');
  const nid = String(input.national_id ?? '').trim();
  const mobile = String(input.mobile ?? '').trim();
  const birth = String(input.birth_date ?? '').trim();
  const first = String(input.first_name ?? '').trim(), last = String(input.last_name ?? '').trim();
  const errs: { field: string; code: string }[] = [];
  if (!/^DEMO-NID-[A-Za-z0-9-]{2,}$/.test(nid)) errs.push({ field: 'national_id', code: 'DEMO_ONLY' });
  if (!/^DEMO-MOBILE-[A-Za-z0-9-]{2,}$/.test(mobile)) errs.push({ field: 'mobile', code: 'DEMO_ONLY' });
  if (!first) errs.push({ field: 'first_name', code: 'REQUIRED' });
  if (!last) errs.push({ field: 'last_name', code: 'REQUIRED' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) errs.push({ field: 'birth_date', code: 'INVALID' });
  else {
    const age = (Date.parse(tehranIso(now)) - Date.parse(birth)) / (365.2425 * 86400000);
    if (age < 18 || age >= 71) errs.push({ field: 'birth_date', code: 'AGE_18_70' });
  }
  if (errs.length) fail('INVALID_IDENTITY_INPUT', 422, 'در محیط نمایشی فقط شناسه‌های DEMO پذیرفته می‌شود و سن باید ۱۸ تا ۷۰ سال باشد.', errs);
  if (await t.one('SELECT id FROM users WHERE national_id_hash=$1 OR mobile_token=$2', [sha256(nid), mobile])) fail('ALREADY_REGISTERED', 409, 'این هویت قبلاً ثبت شده است؛ از نقش موجود وارد شوید.');
  const { bank } = await parties(t);
  const policy = await t.one("SELECT id FROM policies WHERE status='APPROVED' ORDER BY policy_version DESC LIMIT 1");
  const userId = uuid(), customerId = uuid(), appId = uuid();
  await t.q('INSERT INTO users(id,model_id,display_name,mobile_token,national_id_hash,national_id_encrypted) VALUES ($1,$2,$3,$4,$5,$6)', [userId, MODEL_ID, `${first} ${last}`, mobile, sha256(nid), `enc:${nid}`]);
  await t.q("INSERT INTO memberships(model_id,user_id,role,scopes) VALUES ($1,$2,'customer','[\"self\"]')", [MODEL_ID, userId]);
  await t.q(`INSERT INTO customers(id,model_id,user_id,identity_details,verified_monthly_income_irr) VALUES ($1,$2,$3,$4,500000000)`,
    [customerId, MODEL_ID, userId, JSON.stringify({ national_id: nid, birth_date: birth, name: first, family_name: last, note: 'income is a synthetic mock-verified value' })]);
  await t.q(`INSERT INTO applications(id,model_id,customer_id,referral_id,creditor_id,policy_id,status,expires_at) VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7)`, [appId, MODEL_ID, customerId, ref.id, bank, policy.id, iso(addMinutes(now, 30 * 1440))]);
  await t.q('INSERT INTO wallets(model_id,customer_id) VALUES ($1,$2)', [MODEL_ID, customerId]);
  await audit(t, null, 'customer.registered_from_referral', 'application', appId, { referral: ref.id });
  return { user_id: userId, application_id: appId };
}
