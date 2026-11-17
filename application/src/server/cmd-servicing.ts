/** Bank disbursement, returns/refunds, bank amendment, wallet, collections, guarantees and support. */
import { MODEL_ID, Q } from './db';
import { Actor, parseMoney, accountBalance, addDays, assertChecker, audit, big, clock, dayDiff, fail, iso, notify, outbox, parties, post, requireScope, sha256, tehranIso, uuid } from './core';
import { guaranteeClaim, refundPlanN, roundHalfUp } from './kit';
import { inquirePayout, mockPayoutProvider } from './payments';
import { installments, refreshInstallmentStatuses, releaseOutstanding, residual, statement } from './services';
import type { Ctx } from './cmd-application';

// ------------------------------------------------------------------ bank clinic disbursement (maker/checker)
export async function proposeDisbursement(t: Q, actor: Actor, input: any) {
  requireScope(actor, 'funding');
  const s = await t.one('SELECT * FROM settlements WHERE id=$1 FOR UPDATE', [input.settlement_id]);
  if (!s || s.from_party_id !== actor.orgId) fail('NOT_FOUND', 404);
  if (s.status !== 'QUEUED' && s.status !== 'FAILED') fail('INVALID_TRANSITION', 409);
  const p = await t.one('SELECT * FROM purchases WHERE id=$1', [s.purchase_id]);
  const custody = await t.one<{ n: number }>("SELECT count(*)::int n FROM checks WHERE purchase_id=$1 AND status='IN_CUSTODY' AND beneficiary_id=$2", [p.id, actor.orgId]);
  const expected = (await t.one<{ n: number }>("SELECT count(*)::int - 1 AS n FROM installments WHERE purchase_id=$1 AND status<>'SUPERSEDED'", [p.id]))!.n;
  if (custody!.n < expected) fail('SECURITY_NOT_READY', 422, 'همه چک‌های اقساط باید به نام بانک و در امانت بانک باشد.');
  const clinic = await t.one('SELECT payout_account_token FROM organizations WHERE id=$1', [s.to_party_id]);
  if (!clinic?.payout_account_token) fail('BENEFICIARY_UNVERIFIED', 422, 'حساب تسویه کلینیک تأیید نشده است.');
  const pending = await t.one("SELECT id FROM approvals WHERE resource_id=$1 AND action='CLINIC_PAYOUT' AND status='PENDING'", [s.id]);
  if (pending) return { approval_id: pending.id, status: 'PENDING', duplicate: true };
  const id = uuid();
  await t.q(`INSERT INTO approvals(id,model_id,resource_type,resource_id,action,payload_hash,proposed_by,status) VALUES ($1,$2,'settlement',$3,'CLINIC_PAYOUT',$4,$5,'PENDING')`,
    [id, MODEL_ID, s.id, sha256(`${s.id}:${s.amount_irr}:${s.to_party_id}:${clinic.payout_account_token}`), actor.userId]);
  return { approval_id: id, status: 'PENDING', amount_irr: big(s.amount_irr) };
}

export async function approveDisbursement(t: Q, actor: Actor, input: any, ctx: Ctx) {
  requireScope(actor, 'funding');
  const a = await t.one("SELECT * FROM approvals WHERE id=$1 AND action='CLINIC_PAYOUT' FOR UPDATE", [input.approval_id]);
  if (!a) fail('NOT_FOUND', 404);
  if (a.status !== 'PENDING') fail('INVALID_TRANSITION', 409);
  assertChecker(a.proposed_by, actor.userId);
  const s = await t.one('SELECT * FROM settlements WHERE id=$1 FOR UPDATE', [a.resource_id]);
  if (s.from_party_id !== actor.orgId) fail('NOT_FOUND', 404);
  await t.q("UPDATE approvals SET status='APPROVED', approved_by=$2, version=version+1, updated_at=now() WHERE id=$1", [a.id, actor.userId]);
  // One stable transfer reference per economic obligation: inquiry/retry never creates a second transfer.
  const ref = s.external_reference || `MOCK-BANK-PAYOUT-${s.id.slice(0, 8)}`;
  await t.q("UPDATE settlements SET status='SUBMITTED', external_reference=$2, version=version+1, updated_at=now() WHERE id=$1", [s.id, ref]);
  ctx.effects.push(async () => { await mockPayoutProvider('CLINIC_PAYOUT', ref, input.scenario ?? 'confirmed'); });
  return { settlement_id: s.id, external_reference: ref, status: 'SUBMITTED' };
}

export async function inquireDisbursement(t: Q, actor: Actor, input: any, ctx: Ctx) {
  const s = await t.one('SELECT * FROM settlements WHERE id=$1', [input.settlement_id]);
  if (!s || (actor.role === 'bank' && s.from_party_id !== actor.orgId)) fail('NOT_FOUND', 404);
  if (!['UNKNOWN', 'SUBMITTED'].includes(s.status)) return { status: s.status };
  ctx.effects.push(async () => { await inquirePayout('CLINIC_PAYOUT', s.external_reference); });
  return { status: 'INQUIRY_SENT', external_reference: s.external_reference };
}

// ------------------------------------------------------------------ returns (clinic initiator + distinct clinic checker)
function planFor(p: any, rows: any[], cumulative: bigint) {
  return refundPlanN({
    principal: big(p.principal_irr), commission: big(p.commission_irr), cumulativeReturn: cumulative,
    installments: rows.map((i) => ({
      id: i.id,
      principal: { original: i.principal_irr, paid: i.principal_paid_irr, cancelled: i.principal_cancelled_irr, refunded: i.principal_refunded_irr },
      commission: { original: i.commission_irr, paid: i.commission_paid_irr, cancelled: i.commission_cancelled_irr, refunded: i.commission_refunded_irr },
    })),
  });
}

export async function requestReturn(t: Q, actor: Actor, input: any) {
  requireScope(actor, 'returns');
  const p = await t.one('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [input.purchase_id]);
  if (!p || p.business_id !== actor.orgId) fail('NOT_FOUND', 404);
  if (!['CONFIRMED', 'PARTIALLY_RETURNED', 'SETTLED'].includes(p.status)) fail('INVALID_TRANSITION', 409);
  const amount = parseMoney(input.return_principal_irr || '0', 'return_principal_irr');
  const cumulative = big(p.returned_principal_irr) + amount;
  if (amount <= 0n || cumulative > big(p.principal_irr)) fail('RETURN_EXCEEDS_UNRETURNED', 422, 'مبلغ برگشت بیش از ارزش برگشت‌نشده خدمت است.', [{ field: 'return_principal_irr', code: 'INVALID' }]);
  const reason = String(input.reason ?? '').trim();
  if (!reason) fail('REASON_REQUIRED', 422, 'دلیل و مستند برگشت الزامی است.', [{ field: 'reason', code: 'REQUIRED' }]);
  const dup = await t.one("SELECT id FROM refunds WHERE purchase_id=$1 AND cumulative_principal_irr=$2 AND status IN ('REQUESTED','POSTED','FUNDED','FUNDING_DELAYED')", [p.id, cumulative]);
  if (dup) return { refund_id: dup.id, duplicate: true };
  if (await t.one("SELECT id FROM refunds WHERE purchase_id=$1 AND status='REQUESTED'", [p.id])) fail('RETURN_PENDING', 409, 'درخواست برگشت دیگری در انتظار تأیید است.');
  const plan = planFor(p, await installments(t, p.id), cumulative);
  const priorCommission = roundHalfUp(big(p.commission_irr) * big(p.returned_principal_irr), big(p.principal_irr));
  const id = uuid();
  await t.q(`INSERT INTO refunds(id,model_id,purchase_id,requested_by,cumulative_principal_irr,principal_delta_irr,commission_delta_irr,wallet_entitlement_irr,reason,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'REQUESTED')`,
    [id, MODEL_ID, p.id, actor.userId, cumulative, amount, plan.cumulativeCommission - priorCommission, plan.walletDelta, reason]);
  return { refund_id: id, status: 'REQUESTED', preview: { wallet_refund_irr: plan.walletDelta, principal_released_irr: plan.principalReleased, cash_contribution_note: 'سهم پرداخت نقدی خارج از BNPL توسط کلینیک بازگردانده می‌شود' } };
}

export async function approveReturn(t: Q, actor: Actor, input: any) {
  requireScope(actor, 'returns');
  const r = await t.one('SELECT * FROM refunds WHERE id=$1 FOR UPDATE', [input.refund_id]);
  if (!r) fail('NOT_FOUND', 404);
  const p = await t.one('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [r.purchase_id]);
  if (p.business_id !== actor.orgId) fail('NOT_FOUND', 404);
  if (r.status !== 'REQUESTED') return { refund_id: r.id, status: r.status, duplicate: true };
  assertChecker(r.requested_by, actor.userId);
  const now = await clock(t);
  const { bank, paystar } = await parties(t);
  const rows = await installments(t, p.id);
  for (const i of rows) await t.q('SELECT id FROM installments WHERE id=$1 FOR UPDATE', [i.id]);
  // Recompute from current component state (payments may have happened since request).
  const plan = planFor(p, rows, big(r.cumulative_principal_irr));
  let cancelP = 0n, cancelC = 0n, refundP = 0n, refundC = 0n;
  for (const ch of plan.changes) {
    if (ch.cancelDelta === 0n && ch.refundDelta === 0n) continue;
    await t.q('INSERT INTO refund_components(model_id,refund_id,installment_id,component,cancelled_irr,refunded_irr) VALUES ($1,$2,$3,$4,$5,$6)',
      [MODEL_ID, r.id, ch.installmentId, ch.component.toUpperCase(), ch.cancelDelta, ch.refundDelta]);
    await t.q(`UPDATE installments SET ${ch.component}_cancelled_irr=${ch.component}_cancelled_irr+$2, ${ch.component}_refunded_irr=${ch.component}_refunded_irr+$3, version=version+1, updated_at=now() WHERE id=$1`,
      [ch.installmentId, ch.cancelDelta, ch.refundDelta]);
    if (ch.component === 'principal') { cancelP += ch.cancelDelta; refundP += ch.refundDelta; } else { cancelC += ch.cancelDelta; refundC += ch.refundDelta; }
  }
  const full = big(r.cumulative_principal_irr) === big(p.principal_irr);
  await t.q('UPDATE purchases SET returned_principal_irr=$2, status=$3, version=version+1, updated_at=now() WHERE id=$1', [p.id, r.cumulative_principal_irr, full ? 'RETURNED' : 'PARTIALLY_RETURNED']);
  // Only outstanding principal that is cancelled releases credit; refunded paid principal does not release again.
  await releaseOutstanding(t, p.credit_line_id, p.business_id, plan.principalReleased);
  await refreshInstallmentStatuses(t, p.id);
  const book = p.current_owner_id;
  await post(t, book, `REFUND_CANCEL:${r.id}`, 'REFUND', r.id, [
    { code: 'CLINIC_RECOVERY', debit: cancelP }, { code: 'DEFERRED_COMMISSION', debit: cancelC },
    { code: 'CUSTOMER_PRINCIPAL', credit: cancelP }, { code: 'CUSTOMER_COMMISSION', credit: cancelC }]);
  const wallet = plan.walletDelta;
  if (wallet > 0n) {
    await post(t, book, `REFUND_PAID:${r.id}`, 'REFUND', r.id, [
      { code: 'CLINIC_RECOVERY', debit: refundP }, { code: 'COMMISSION_REVENUE', debit: refundC }, { code: 'CUSTOMER_REFUND_PAYABLE', credit: wallet }]);
    await post(t, book, `REFUND_CLEARING:${r.id}`, 'REFUND', r.id, [{ code: 'CUSTOMER_REFUND_PAYABLE', debit: wallet }, { code: 'DUE_TO_PAYSTAR', credit: wallet }]);
  }
  // PayStar refund bridge funds the customer wallet promptly; exhaustion records liability without fictitious cash.
  const bridge = await accountBalance(t, paystar, 'REFUND_BRIDGE_CASH');
  const w = await t.one('SELECT * FROM wallets WHERE customer_id=$1 FOR UPDATE', [p.customer_id]);
  let status = 'FUNDED';
  if (wallet > 0n) {
    if (bridge >= wallet) {
      await post(t, paystar, `BRIDGE:${r.id}`, 'REFUND', r.id, [{ code: 'PARTNER_RECOVERY', debit: wallet }, { code: 'REFUND_BRIDGE_CASH', credit: wallet }]);
      const j = await post(t, paystar, `WALLET_FUND:${r.id}`, 'REFUND', r.id, [{ code: 'WALLET_CASH', debit: wallet }, { code: 'WALLET_LIABILITY', credit: wallet }]);
      await t.q('UPDATE wallets SET liability_irr=liability_irr+$2, funded_irr=funded_irr+$2, version=version+1, updated_at=now() WHERE id=$1', [w.id, wallet]);
      await t.q(`INSERT INTO wallet_entries(model_id,wallet_id,refund_id,entry_type,amount_irr,event_key,journal_id) VALUES ($1,$2,$3,'ENTITLEMENT',$4,$5,$6),($1,$2,$3,'FUNDED',$4,$7,$6)`,
        [MODEL_ID, w.id, r.id, wallet, `ENTITLEMENT:${r.id}`, j.id, `FUNDED:${r.id}`]);
    } else {
      status = 'FUNDING_DELAYED';
      const j = await post(t, paystar, `WALLET_OWED:${r.id}`, 'REFUND', r.id, [{ code: 'PARTNER_RECOVERY', debit: wallet }, { code: 'WALLET_LIABILITY', credit: wallet }]);
      await t.q('UPDATE wallets SET liability_irr=liability_irr+$2, version=version+1, updated_at=now() WHERE id=$1', [w.id, wallet]);
      await t.q(`INSERT INTO wallet_entries(model_id,wallet_id,refund_id,entry_type,amount_irr,event_key,journal_id) VALUES ($1,$2,$3,'ENTITLEMENT',$4,$5,$6)`, [MODEL_ID, w.id, r.id, wallet, `ENTITLEMENT:${r.id}`, j.id]);
      await t.q("UPDATE app_demo_state SET originations_paused=true, pause_reason='REFUND_BRIDGE_EXHAUSTED' WHERE id=1");
    }
  }
  await t.q('UPDATE refunds SET approved_by=$2, status=$3, posted_at=$4, version=version+1, updated_at=now() WHERE id=$1', [r.id, actor.userId, status, iso(now)]);
  // Separate bank service fee reverses proportionately to cumulative return.
  const inv = await t.one("SELECT * FROM invoices WHERE purchase_id=$1 AND invoice_type='BANK_ORIGINATION_SERVICE' FOR UPDATE", [p.id]);
  if (inv) {
    const target = roundHalfUp(big(inv.net_irr) * big(r.cumulative_principal_irr), big(p.principal_irr));
    await t.q('UPDATE invoices SET reversed_irr=$2, status=$3, version=version+1, updated_at=now() WHERE id=$1', [inv.id, target, target === big(inv.net_irr) ? 'REVERSED' : inv.status]);
  }
  // Pending bank amendment: the bank books remain authoritative until acknowledged.
  const st = (await statement(t, p.id))!;
  await t.q(`INSERT INTO bank_instructions(model_id,bank_id,purchase_id,instruction_type,external_reference,status,expected_balance_irr,payload_hash) VALUES ($1,$2,$3,'REFUND_AMENDMENT',$4,'PENDING',$5,$6)`,
    [MODEL_ID, bank, p.id, `PS-AMEND-${r.id.slice(0, 8)}`, st.totals.outstandingPrincipal, sha256(JSON.stringify(plan.changes, (_k, v) => (typeof v === 'bigint' ? String(v) : v)))]);
  // Checks: fully cancelled installments await release; partially cancelled need replacement with bank evidence.
  for (const i of await installments(t, p.id)) {
    const res = residual(i);
    if (res.total === 0n) await t.q("UPDATE checks SET status='RELEASE_PENDING', version=version+1, updated_at=now() WHERE installment_id=$1 AND status='IN_CUSTODY'", [i.id]);
    else await t.q(`UPDATE checks SET evidence=evidence || $2::jsonb, version=version+1, updated_at=now() WHERE installment_id=$1 AND status='IN_CUSTODY' AND amount_irr<>$3`,
      [i.id, JSON.stringify({ replacement_required: true, new_amount_irr: String(res.total) }), res.total]);
  }
  await outbox(t, 'refund', r.id, 'refund.posted.v1', { purchase_id: p.id, wallet_irr: wallet, principal_released_irr: plan.principalReleased });
  const u = await t.one('SELECT user_id FROM customers WHERE id=$1', [p.customer_id]);
  await notify(t, u!.user_id, `REFUND:${r.id}`, 'refund_approved', {});
  return { refund_id: r.id, status, wallet_refund_irr: wallet, principal_released_irr: plan.principalReleased, remaining_principal_irr: st.totals.outstandingPrincipal, pending_bank_amendment: true };
}

export async function rejectReturn(t: Q, actor: Actor, input: any) {
  requireScope(actor, 'returns');
  const r = await t.one('SELECT r.*, p.business_id FROM refunds r JOIN purchases p ON p.id=r.purchase_id WHERE r.id=$1 FOR UPDATE OF r', [input.refund_id]);
  if (!r || r.business_id !== actor.orgId) fail('NOT_FOUND', 404);
  if (r.status !== 'REQUESTED') fail('INVALID_TRANSITION', 409);
  assertChecker(r.requested_by, actor.userId);
  await t.q("UPDATE refunds SET status='REJECTED', approved_by=$2, version=version+1, updated_at=now() WHERE id=$1", [r.id, actor.userId]);
  return { status: 'REJECTED' };
}

/** Bank acknowledges the debt-schedule amendment; releases/replaces checks with bank evidence. */
export async function acknowledgeAmendment(t: Q, actor: Actor, input: any) {
  const b = await t.one("SELECT * FROM bank_instructions WHERE id=$1 AND instruction_type='REFUND_AMENDMENT' FOR UPDATE", [input.instruction_id]);
  if (!b || b.bank_id !== actor.orgId) fail('NOT_FOUND', 404);
  if (b.status !== 'PENDING') return { status: b.status, duplicate: true };
  const now = await clock(t);
  const st = (await statement(t, b.purchase_id))!;
  await t.q("UPDATE bank_instructions SET status='CONFIRMED', acknowledged_balance_irr=$2, acknowledged_at=$3, version=version+1, updated_at=now() WHERE id=$1", [b.id, st.totals.outstandingPrincipal, iso(now)]);
  // Earlier pending amendments for the same purchase are superseded by this acknowledged balance.
  await t.q("UPDATE bank_instructions SET status='SUPERSEDED', version=version+1, updated_at=now() WHERE purchase_id=$1 AND instruction_type='REFUND_AMENDMENT' AND status='PENDING'", [b.purchase_id]);
  await releaseChecks(t, actor, b.purchase_id, now);
  return { status: 'CONFIRMED', acknowledged_balance_irr: st.totals.outstandingPrincipal };
}

async function releaseChecks(t: Q, actor: Actor, purchaseId: string, now: Date) {
  for (const c of await t.q("SELECT * FROM checks WHERE purchase_id=$1 AND status IN ('RELEASE_PENDING','IN_CUSTODY') FOR UPDATE", [purchaseId])) {
    const inst = await t.one('SELECT * FROM installments WHERE id=$1', [c.installment_id]);
    const res = inst ? residual(inst) : { total: 0n };
    if (c.status === 'RELEASE_PENDING') {
      await t.q("UPDATE checks SET status='RELEASED', version=version+1, updated_at=now() WHERE id=$1", [c.id]);
      await t.q(`INSERT INTO check_events(model_id,check_id,event_type,from_holder_id,external_reference,effective_at,evidence_hash,actor_id) VALUES ($1,$2,'RELEASED',$3,$4,$5,$6,$7)`,
        [MODEL_ID, c.id, c.custodian_id, `MOCK-BANK-RELEASE-${c.sayad_id_token}`, iso(now), sha256('REL' + c.id), actor.userId]);
    } else if (c.evidence?.replacement_required && res.total > 0n) {
      await t.q("UPDATE checks SET status='RELEASED', version=version+1, updated_at=now() WHERE id=$1", [c.id]);
      await t.q(`INSERT INTO check_events(model_id,check_id,event_type,from_holder_id,external_reference,effective_at,evidence_hash,actor_id) VALUES ($1,$2,'RELEASED_FOR_REPLACEMENT',$3,$4,$5,$6,$7)`,
        [MODEL_ID, c.id, c.custodian_id, `MOCK-BANK-REPLACE-${c.sayad_id_token}`, iso(now), sha256('REP' + c.id), actor.userId]);
      const nid = uuid();
      const n = (await t.one<{ n: number }>("SELECT count(*)::int n FROM checks WHERE sayad_id_token LIKE $1", [c.sayad_id_token.replace(/-R\d+$/, '') + '%']))!.n;
      const token = c.sayad_id_token.replace(/-R\d+$/, '') + `-R${n}`;
      await t.q(`INSERT INTO checks(id,model_id,checkout_id,expected_installment_sequence,purchase_id,installment_id,sayad_id_token,issuer_customer_id,beneficiary_id,custodian_id,amount_irr,maturity_date,status,evidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'IN_CUSTODY',$13)`,
        [nid, MODEL_ID, c.checkout_id, c.expected_installment_sequence, purchaseId, c.installment_id, token, c.issuer_customer_id, c.beneficiary_id, c.custodian_id, res.total, c.maturity_date, JSON.stringify({ replacement_of: c.id, registered: true, accepted: true, demo: true })]);
      await t.q(`INSERT INTO check_events(model_id,check_id,event_type,to_holder_id,external_reference,effective_at,evidence_hash,actor_id) VALUES ($1,$2,'IN_CUSTODY',$3,$4,$5,$6,$7)`,
        [MODEL_ID, nid, c.custodian_id, `MOCK-BANK-CUSTODY-${token}`, iso(now), sha256('NEW' + nid), actor.userId]);
    }
  }
}

export async function releaseSettledChecks(t: Q, actor: Actor, input: any) {
  const p = await t.one('SELECT * FROM purchases WHERE id=$1', [input.purchase_id]);
  if (!p || p.current_owner_id !== actor.orgId) fail('NOT_FOUND', 404);
  const now = await clock(t);
  await releaseChecks(t, actor, p.id, now);
  return { released: true };
}

// ------------------------------------------------------------------ wallet withdrawal
export async function withdraw(t: Q, actor: Actor, input: any, ctx: Ctx) {
  const w = await t.one('SELECT * FROM wallets WHERE customer_id=$1 FOR UPDATE', [actor.customerId]);
  if (!w) fail('NOT_FOUND', 404);
  const amount = parseMoney(input.amount_irr || '0', 'amount_irr');
  const available = big(w.funded_irr) - big(w.held_irr);
  const now = await clock(t);
  const acct = await t.one('SELECT * FROM bank_accounts WHERE id=$1 AND owner_user_id=$2 AND owner_match', [input.bank_account_id, actor.userId]);
  if (!acct) fail('ACCOUNT_NOT_VERIFIED', 422, 'فقط حساب تأییدشده به نام خود مشتری مجاز است.', [{ field: 'bank_account_id', code: 'INVALID' }]);
  if (acct.cooling_until && new Date(acct.cooling_until) > now) fail('ACCOUNT_COOLING', 422, 'حساب جدید تا پایان دوره ۲۴ ساعته قابل برداشت نیست.');
  if (amount <= 0n || amount > available) fail('INSUFFICIENT_WALLET', 422, 'مبلغ از موجودی قابل برداشت (پشتوانه‌دار) بیشتر است.', [{ field: 'amount_irr', code: 'INSUFFICIENT' }]);
  if (amount < 10000n && amount !== available) fail('BELOW_MINIMUM', 422, 'حداقل برداشت ۱٬۰۰۰ تومان است.', [{ field: 'amount_irr', code: 'MIN' }]);
  const today = tehranIso(now);
  const day = await t.one<{ s: bigint }>(`SELECT COALESCE(sum(amount_irr),0)::bigint s FROM withdrawals WHERE wallet_id=$1 AND status<>'FAILED' AND created_at::date=now()::date`, [w.id]);
  if (day!.s + amount > 400000000n) fail('DAILY_LIMIT', 422, `سقف برداشت روزانه (${today}) ۴۰ میلیون تومان است.`);
  const id = uuid();
  const ref = `MOCK-WD-${id.slice(0, 8)}`;
  await t.q('UPDATE wallets SET held_irr=held_irr+$2, version=version+1, updated_at=now() WHERE id=$1', [w.id, amount]);
  await t.q(`INSERT INTO withdrawals(id,model_id,wallet_id,bank_account_id,amount_irr,status,provider_reference) VALUES ($1,$2,$3,$4,$5,'SUBMITTED',$6)`, [id, MODEL_ID, w.id, acct.id, amount, ref]);
  ctx.effects.push(async () => { await mockPayoutProvider('WITHDRAWAL', ref, input.scenario ?? 'confirmed'); });
  return { withdrawal_id: id, status: 'SUBMITTED', provider_reference: ref };
}

export async function inquireWithdrawal(t: Q, actor: Actor, input: any, ctx: Ctx) {
  const w = await t.one('SELECT w.*, wa.customer_id FROM withdrawals w JOIN wallets wa ON wa.id=w.wallet_id WHERE w.id=$1', [input.withdrawal_id]);
  if (!w || (actor.role === 'customer' && w.customer_id !== actor.customerId)) fail('NOT_FOUND', 404);
  if (!['UNKNOWN', 'SUBMITTED'].includes(w.status)) return { status: w.status };
  ctx.effects.push(async () => { await inquirePayout('WITHDRAWAL', w.provider_reference); });
  return { status: 'INQUIRY_SENT' };
}

// ------------------------------------------------------------------ collections & guarantees
export async function logContact(t: Q, actor: Actor, input: any) {
  const c = await t.one('SELECT * FROM collection_cases WHERE id=$1 FOR UPDATE', [input.case_id]);
  if (!c) fail('NOT_FOUND', 404);
  const now = await clock(t);
  if (actor.role === 'paystar-admin') {
    // Delegated soft collection only up to DPD29 and only under a valid servicing mandate.
    if (c.dpd >= 30 || !['MONITORING', 'SOFT'].includes(c.stage)) fail('MANDATE_EXCEEDED', 403, 'از روز ۳۰ پیگیری با بانک است؛ پی‌استار فقط تا DPD29 مجاز است.');
  }
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tehran', hour: 'numeric', hour12: false }).format(now));
  if (hour < 9 || hour >= 18) fail('CONTACT_WINDOW', 422, 'تماس فقط بین ساعت ۹ تا ۱۸ تهران مجاز است.');
  const today = await t.one("SELECT id FROM collection_actions WHERE case_id=$1 AND action_type='CUSTOMER_CONTACT' AND occurred_at::date=$2::date", [c.id, iso(now)]);
  if (today && (input.action_type ?? 'CUSTOMER_CONTACT') === 'CUSTOMER_CONTACT') fail('CONTACT_LIMIT', 422, 'حداکثر یک تماس انسانی در روز مجاز است.');
  await t.q('INSERT INTO collection_actions(model_id,case_id,actor_id,action_type,occurred_at,result_code,notes) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [MODEL_ID, c.id, actor.userId, input.action_type ?? 'CUSTOMER_CONTACT', iso(now), input.result_code ?? 'NO_ANSWER', String(input.notes ?? '')]);
  return { logged: true };
}

export async function recordRecovery(t: Q, actor: Actor, input: any) {
  const c = await t.one('SELECT * FROM collection_cases WHERE id=$1 FOR UPDATE', [input.case_id]);
  if (!c || c.creditor_id !== actor.orgId) fail('NOT_FOUND', 404);
  const type = String(input.action_type);
  if (!['CUSTOMER_RECOVERY_ATTEMPT', 'CHECK_PRESENTATION'].includes(type)) fail('INVALID_ACTION', 400);
  const now = await clock(t);
  await t.q('INSERT INTO collection_actions(model_id,case_id,actor_id,action_type,occurred_at,result_code,notes) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [MODEL_ID, c.id, actor.userId, type, iso(now), input.result_code ?? 'UNRECOVERED', String(input.notes ?? 'ثبت نمایشی')]);
  if (c.stage === 'LEGAL_ACTIVE') await t.q("UPDATE collection_cases SET stage='RECOVERY', version=version+1, updated_at=now() WHERE id=$1", [c.id]);
  return { recorded: type };
}

export async function authorizeLegal(t: Q, actor: Actor, input: any) {
  if (!actor.scopes.includes('legal') && !actor.scopes.includes('collections')) fail('FORBIDDEN', 403);
  const c = await t.one('SELECT * FROM collection_cases WHERE id=$1 FOR UPDATE', [input.case_id]);
  if (!c || c.creditor_id !== actor.orgId) fail('NOT_FOUND', 404);
  if (c.stage !== 'LEGAL_REVIEW' || c.dpd < 30) fail('INVALID_TRANSITION', 409, 'اقدام حقوقی فقط پس از DPD30 و ارجاع پرونده مجاز است.');
  const now = await clock(t);
  await t.q("UPDATE collection_cases SET stage='LEGAL_ACTIVE', legal_authorized_at=$2, evidence=evidence || $3::jsonb, version=version+1, updated_at=now() WHERE id=$1",
    [c.id, iso(now), JSON.stringify({ legal_authorized_by: actor.userId, legal_review_evidence: 'DEMO-LEGAL-REVIEW', enforcement_not_authorized: false })]);
  await audit(t, actor, 'collections.legal_authorized', 'collection_case', c.id);
  return { stage: 'LEGAL_ACTIVE' };
}

/** Capped clinic guarantee claim: DPD60, legal authority, documented customer+check recovery for 15 days. */
export async function proposeGuaranteeClaim(t: Q, actor: Actor, input: any) {
  const c = await t.one('SELECT * FROM collection_cases WHERE id=$1 FOR UPDATE', [input.case_id]);
  if (!c || c.creditor_id !== actor.orgId) fail('NOT_FOUND', 404);
  const p = await t.one('SELECT * FROM purchases WHERE id=$1', [c.purchase_id]);
  const g = await t.one("SELECT * FROM guarantees WHERE business_id=$1 AND beneficiary_id=$2 FOR UPDATE", [p.business_id, actor.orgId]);
  if (!g) fail('NO_GUARANTEE', 422, 'ضمانت کلینیک برای این بانک ثبت نشده است.');
  const now = await clock(t);
  const actions = await t.q("SELECT action_type, occurred_at FROM collection_actions WHERE case_id=$1 AND action_type IN ('CUSTOMER_RECOVERY_ATTEMPT','CHECK_PRESENTATION') ORDER BY occurred_at", [c.id]);
  const hasCustomer = actions.some((a: any) => a.action_type === 'CUSTOMER_RECOVERY_ATTEMPT');
  const hasCheck = actions.some((a: any) => a.action_type === 'CHECK_PRESENTATION');
  const recoveryDays = actions.length ? dayDiff(tehranIso(now), tehranIso(new Date(actions[0].occurred_at))) : 0;
  const missing: { field: string; code: string }[] = [];
  if (c.dpd < 60) missing.push({ field: 'dpd', code: 'BELOW_60' });
  if (!c.legal_authorized_at) missing.push({ field: 'legal_authorization', code: 'REQUIRED' });
  if (!hasCustomer) missing.push({ field: 'customer_recovery_attempt', code: 'REQUIRED' });
  if (!hasCheck) missing.push({ field: 'check_presentation', code: 'REQUIRED' });
  if (recoveryDays < 15) missing.push({ field: 'recovery_window_days', code: `ONLY_${recoveryDays}` });
  if (missing.length) fail('GUARANTEE_PREREQUISITES', 422, 'ترتیب وصول رعایت نشده: ابتدا مجوز حقوقی، پیگیری مشتری، ارائه چک و ۱۵ روز وصول مستند لازم است.', missing);
  const st = (await statement(t, p.id))!;
  const amount = guaranteeClaim({ residualPrincipal: st.totals.outstandingPrincipal, coverageBps: BigInt(g.coverage_bps), cap: big(g.cap_irr), used: big(g.used_irr), reserved: big(g.reserved_claim_irr), availableSecurity: big(g.cap_irr), dpd: c.dpd, recoveryDays, legalApproved: true });
  if (amount <= 0n) fail('GUARANTEE_CAP_EXHAUSTED', 422, 'سقف ضمانت استفاده شده است.');
  const id = uuid();
  await t.q(`INSERT INTO guarantee_claims(id,model_id,guarantee_id,case_id,requested_irr,status,proposed_by,recovery_rights) VALUES ($1,$2,$3,$4,$5,'ELIGIBLE',$6,$7)`,
    [id, MODEL_ID, g.id, c.id, amount, actor.userId, JSON.stringify({ customer_debt_remains: true, subrogation: 'PENDING_RECOVERY' })]);
  await t.q('UPDATE guarantees SET reserved_claim_irr=reserved_claim_irr+$2, version=version+1, updated_at=now() WHERE id=$1', [g.id, amount]);
  return { claim_id: id, requested_irr: amount, basis: { residual_principal_irr: st.totals.outstandingPrincipal, coverage_bps: g.coverage_bps, cap_irr: g.cap_irr } };
}

export async function approveGuaranteeClaim(t: Q, actor: Actor, input: any) {
  requireScope(actor, 'legal');
  const cl = await t.one('SELECT gc.*, g.beneficiary_id FROM guarantee_claims gc JOIN guarantees g ON g.id=gc.guarantee_id WHERE gc.id=$1 FOR UPDATE OF gc', [input.claim_id]);
  if (!cl || cl.beneficiary_id !== actor.orgId) fail('NOT_FOUND', 404);
  if (cl.status !== 'ELIGIBLE') fail('INVALID_TRANSITION', 409);
  assertChecker(cl.proposed_by, actor.userId);
  await t.q("UPDATE guarantee_claims SET status='SUBMITTED', approved_by=$2, version=version+1, updated_at=now() WHERE id=$1", [cl.id, actor.userId]);
  return { status: 'SUBMITTED' };
}

export async function payGuaranteeClaim(t: Q, actor: Actor, input: any) {
  const cl = await t.one('SELECT gc.*, g.business_id, g.beneficiary_id FROM guarantee_claims gc JOIN guarantees g ON g.id=gc.guarantee_id WHERE gc.id=$1 FOR UPDATE OF gc', [input.claim_id]);
  if (!cl || cl.business_id !== actor.orgId) fail('NOT_FOUND', 404);
  if (cl.status !== 'SUBMITTED') fail('INVALID_TRANSITION', 409);
  const amt = big(cl.requested_irr);
  await t.q("UPDATE guarantee_claims SET status='RECOVERED', recovered_irr=$2, recovery_rights=recovery_rights || '{\"subrogation\":\"RECORDED_DEMO\"}'::jsonb, version=version+1, updated_at=now() WHERE id=$1", [cl.id, amt]);
  await t.q('UPDATE guarantees SET reserved_claim_irr=reserved_claim_irr-$2, used_irr=used_irr+$2, version=version+1, updated_at=now() WHERE id=$1', [cl.guarantee_id, amt]);
  // Recovery proceeds reduce creditor loss; the customer debt is NOT discharged.
  await post(t, cl.beneficiary_id, `GUARANTEE_RECOVERY:${cl.id}`, 'GUARANTEE_CLAIM', cl.id, [{ code: 'CASH', debit: amt }, { code: 'GUARANTEE_RECOVERY_CLEARING', credit: amt }]);
  return { status: 'RECOVERED', customer_debt_unchanged: true };
}

// ------------------------------------------------------------------ support, disputes, hardship
export async function createSupport(t: Q, actor: Actor, input: any) {
  const type = String(input.case_type);
  if (!['SERVICE_DISPUTE', 'PAYMENT_DISPUTE', 'HARDSHIP', 'APPEAL', 'GENERAL'].includes(type)) fail('INVALID_TYPE', 400);
  const summary = String(input.summary ?? '').trim();
  if (!summary) fail('SUMMARY_REQUIRED', 422, 'شرح درخواست را وارد کنید.', [{ field: 'summary', code: 'REQUIRED' }]);
  if (input.purchase_id) {
    const p = await t.one('SELECT customer_id FROM purchases WHERE id=$1', [input.purchase_id]);
    if (!p || p.customer_id !== actor.customerId) fail('NOT_FOUND', 404);
  }
  const now = await clock(t);
  const ops = await t.one<{ id: string }>("SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.role='paystar-admin' AND m.scopes ? 'servicing' LIMIT 1");
  const id = uuid();
  await t.q(`INSERT INTO support_cases(id,model_id,customer_id,purchase_id,application_id,case_type,status,assigned_to,summary,due_at) VALUES ($1,$2,$3,$4,$5,$6,'OPEN',$7,$8,$9)`,
    [id, MODEL_ID, actor.customerId, input.purchase_id || null, input.application_id || null, type, ops?.id ?? null, summary, iso(addDays(now, 2))]);
  return { case_id: id, status: 'OPEN', note: 'ثبت اختلاف به‌تنهایی بدهی یا سررسید را تغییر نمی‌دهد؛ برگشت مالی فقط با تأیید کلینیک انجام می‌شود.' };
}

export async function resolveSupport(t: Q, actor: Actor, input: any) {
  const c = await t.one('SELECT * FROM support_cases WHERE id=$1 FOR UPDATE', [input.case_id]);
  if (!c) fail('NOT_FOUND', 404);
  if (c.status !== 'OPEN') fail('INVALID_TRANSITION', 409);
  if (c.case_type === 'HARDSHIP' && actor.role !== 'bank') {
    // Hardship amendments belong to the creditor: PayStar forwards with evidence.
    await t.q("UPDATE support_cases SET status='CREDITOR_REVIEW', resolution=$2, version=version+1, updated_at=now() WHERE id=$1", [c.id, JSON.stringify({ forwarded_by: actor.userId, note: input.resolution ?? '' })]);
    return { status: 'CREDITOR_REVIEW' };
  }
  await t.q("UPDATE support_cases SET status='RESOLVED', resolution=$2, version=version+1, updated_at=now() WHERE id=$1", [c.id, JSON.stringify({ by: actor.userId, note: input.resolution ?? '' })]);
  return { status: 'RESOLVED' };
}

export async function decideHardship(t: Q, actor: Actor, input: any) {
  const c = await t.one("SELECT s.*, p.current_owner_id FROM support_cases s JOIN purchases p ON p.id=s.purchase_id WHERE s.id=$1 AND s.case_type='HARDSHIP' FOR UPDATE OF s", [input.case_id]);
  if (!c || c.current_owner_id !== actor.orgId) fail('NOT_FOUND', 404);
  if (!['OPEN', 'CREDITOR_REVIEW'].includes(c.status)) fail('INVALID_TRANSITION', 409);
  const approve = input.outcome === 'APPROVE';
  await t.q('UPDATE support_cases SET status=$2, resolution=resolution || $3::jsonb, version=version+1, updated_at=now() WHERE id=$1',
    [c.id, approve ? 'APPROVED_PENDING_AMENDMENT' : 'REJECTED', JSON.stringify({ bank_decision: approve ? 'APPROVE' : 'REJECT', by: actor.userId, plan: approve ? '۳۰ روز تعویق یک‌باره، بدون کمیسیون اضافه؛ فعال‌سازی پس از امضای الحاقیه و جایگزینی چک' : null, reason: input.reason ?? '' })]);
  return { status: approve ? 'APPROVED_PENDING_AMENDMENT' : 'REJECTED' };
}
