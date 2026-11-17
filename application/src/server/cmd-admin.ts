/** Super-admin controls, demo clock, reconciliation and meeting note. */
import { MODEL_ID, Q } from './db';
import { Actor, accountBalance, assertChecker, audit, big, clock, fail, iso, parties, requireScope, sha256, tehranIso, uuid } from './core';
import { runAllJobs } from './services';

export async function advanceClock(t: Q, actor: Actor, input: any) {
  requireScope(actor, 'demo');
  const minutes = Number(input.minutes ?? 0) + Number(input.hours ?? 0) * 60 + Number(input.days ?? 0) * 1440;
  if (!(minutes > 0) || minutes > 400 * 1440) fail('INVALID_CLOCK_STEP', 422, 'ساعت نمایشی فقط رو به جلو و حداکثر ۴۰۰ روز جابجا می‌شود.');
  const now = await clock(t);
  const next = new Date(+now + minutes * 60000);
  await t.q('UPDATE app_demo_state SET clock=$1 WHERE id=1', [iso(next)]);
  await runAllJobs(t);
  return { clock: iso(next), jobs: ['RESERVATION_EXPIRY', 'ASSESSMENT_TIMEOUT', 'DELINQUENCY', 'REMINDERS'] };
}

export async function runJobsNow(t: Q) {
  await runAllJobs(t);
  return { ran: true };
}

/** Pause/resume new originations: maker proposes, a different super-admin approves. */
export async function proposePause(t: Q, actor: Actor, input: any) {
  const reason = String(input.reason ?? '').trim();
  if (!reason) fail('REASON_REQUIRED', 422, 'دلیل الزامی است.', [{ field: 'reason', code: 'REQUIRED' }]);
  const action = input.pause ? 'PAUSE_ORIGINATIONS' : 'RESUME_ORIGINATIONS';
  const id = uuid();
  await t.q(`INSERT INTO approvals(id,model_id,resource_type,resource_id,action,payload_hash,proposed_by,status) VALUES ($1,$2,'program',$3,$4,$5,$6,'PENDING')`,
    [id, MODEL_ID, '00000000-0000-0000-0000-000000000004', action, sha256(JSON.stringify({ action, reason })), actor.userId]);
  return { approval_id: id, action, reason };
}
export async function approvePause(t: Q, actor: Actor, input: any) {
  const a = await t.one("SELECT * FROM approvals WHERE id=$1 AND action IN ('PAUSE_ORIGINATIONS','RESUME_ORIGINATIONS') FOR UPDATE", [input.approval_id]);
  if (!a) fail('NOT_FOUND', 404);
  if (a.status !== 'PENDING') fail('INVALID_TRANSITION', 409);
  assertChecker(a.proposed_by, actor.userId);
  await t.q("UPDATE approvals SET status='APPROVED', approved_by=$2, version=version+1, updated_at=now() WHERE id=$1", [a.id, actor.userId]);
  const pause = a.action === 'PAUSE_ORIGINATIONS';
  await t.q('UPDATE app_demo_state SET originations_paused=$1, pause_reason=$2 WHERE id=1', [pause, pause ? `تأییدشده توسط ناظر (${a.id.slice(0, 8)})` : null]);
  return { originations_paused: pause };
}

/** Daily reconciliation of the bank collection mirror and PayStar wallet/bridge books. Exceptions stay visible. */
export async function runReconciliation(t: Q, actor: Actor) {
  const now = await clock(t);
  const day = tehranIso(now);
  const { bank, paystar } = await parties(t);
  const receipts = await t.one<{ s: bigint }>(`SELECT COALESCE(sum(pr.amount_irr),0)::bigint s FROM payment_receipts pr JOIN payment_intents pi ON pi.id=pr.intent_id WHERE pi.creditor_id=$1`, [bank]);
  const payouts = await t.one<{ s: bigint }>("SELECT COALESCE(sum(amount_irr),0)::bigint s FROM settlements WHERE from_party_id=$1 AND status='CONFIRMED'", [bank]);
  const closing = await accountBalance(t, bank, 'CASH');
  const opening = closing - receipts!.s + payouts!.s;
  const existing = await t.one('SELECT id FROM reconciliation_runs WHERE model_id=$1 AND account_token=$2 AND business_date=$3', [MODEL_ID, 'MOCK-BANK-COLLECTION', day]);
  const runId = existing?.id ?? uuid();
  if (existing) await t.q("DELETE FROM reconciliation_items WHERE run_id=$1 AND status='OPEN'", [runId]);
  const items: [string, string, bigint][] = [];
  for (const r of await t.q(`SELECT pr.provider_reference, pr.amount_irr FROM payment_receipts pr JOIN payment_intents pi ON pi.id=pr.intent_id
      WHERE pi.creditor_id=$1 AND NOT EXISTS (SELECT 1 FROM journals j WHERE j.source_id=pr.id) AND pr.provider_reference NOT LIKE 'MOCK-RECEIPT-%'`, [bank])) items.push([r.provider_reference, 'MISSING_JOURNAL', big(r.amount_irr)]);
  for (const r of await t.q("SELECT provider_intent_ref, amount_irr FROM payment_intents WHERE status IN ('UNKNOWN','PENDING')")) items.push([r.provider_intent_ref, 'MISSING_CALLBACK', big(r.amount_irr)]);
  for (const r of await t.q("SELECT provider_reference, amount_irr FROM payment_receipts WHERE status IN ('UNAPPLIED','PARTIALLY_UNAPPLIED')")) items.push([r.provider_reference, 'UNAPPLIED_RECEIPT', big(r.amount_irr)]);
  for (const r of await t.q("SELECT external_reference, amount_irr FROM settlements WHERE status IN ('UNKNOWN','SUBMITTED')")) items.push([r.external_reference, 'UNCONFIRMED_PAYOUT', big(r.amount_irr)]);
  for (const r of await t.q("SELECT external_reference, COALESCE(expected_balance_irr,0) amt FROM bank_instructions WHERE instruction_type='REFUND_AMENDMENT' AND status='PENDING'")) items.push([r.external_reference, 'PENDING_BANK_AMENDMENT', big(r.amt)]);
  for (const r of await t.q("SELECT provider_reference, amount_irr FROM withdrawals WHERE status IN ('UNKNOWN','SUBMITTED')")) items.push([r.provider_reference, 'UNCONFIRMED_WITHDRAWAL', big(r.amount_irr)]);
  // Wallet liability must equal funded + delayed; wallet cash must back funded balances exactly.
  const walletCash = await accountBalance(t, paystar, 'WALLET_CASH');
  const funded = await t.one<{ s: bigint }>('SELECT COALESCE(sum(funded_irr),0)::bigint s FROM wallets');
  if (walletCash !== funded!.s) items.push(['WALLET_CASH', 'WALLET_BACKING_MISMATCH', walletCash - funded!.s]);
  const unbalanced = await t.one<{ s: bigint }>("SELECT COALESCE(sum(l.debit_irr-l.credit_irr),0)::bigint s FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE j.status='POSTED'");
  if (unbalanced!.s !== 0n) items.push(['LEDGER', 'UNBALANCED_LEDGER', unbalanced!.s]);
  const status = items.length ? 'EXCEPTIONS' : 'MATCHED';
  if (existing) await t.q('UPDATE reconciliation_runs SET opening_irr=$2, inflow_irr=$3, outflow_irr=$4, closing_irr=$5, status=$6, version=version+1, updated_at=now() WHERE id=$1', [runId, opening, receipts!.s, payouts!.s, closing, status]);
  else await t.q('INSERT INTO reconciliation_runs(id,model_id,account_token,business_date,opening_irr,inflow_irr,outflow_irr,closing_irr,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [runId, MODEL_ID, 'MOCK-BANK-COLLECTION', day, opening, receipts!.s, payouts!.s, closing, status]);
  for (const [ref, type, amt] of items)
    await t.q('INSERT INTO reconciliation_items(model_id,run_id,provider_reference,exception_type,amount_irr,status,assigned_to) VALUES ($1,$2,$3,$4,$5,$6,$7)', [MODEL_ID, runId, ref, type, amt, 'OPEN', actor.userId]);
  return { run_id: runId, status, exceptions: items.length, closing_irr: closing };
}

export async function recordMeeting(t: Q, actor: Actor, input: any) {
  const outcome = String(input.outcome);
  if (!['INTERESTED_IN_PILOT_DESIGN', 'REQUEST_REVISION', 'DECLINE'].includes(outcome)) fail('INVALID_OUTCOME', 400);
  const reasons = String(input.reasons ?? '').trim();
  if (!reasons) fail('REASON_REQUIRED', 422, 'دلایل را وارد کنید.', [{ field: 'reasons', code: 'REQUIRED' }]);
  const now = await clock(t);
  await t.q('INSERT INTO app_meeting_notes(model_id,recorded_by,outcome,reasons,recorded_at) VALUES ($1,$2,$3,$4,$5)', [MODEL_ID, actor.userId, outcome, reasons, iso(now)]);
  return { recorded: outcome, note: 'یادداشت محلی جلسه؛ به معنای تأیید حقوقی یا تعهد بانک نیست.' };
}

// ------------------------------------------------------------------ S1: organizations and members
export const ROLE_SCOPES: Record<string, string[]> = {
  'super-admin': ['organizations', 'policies', 'audit', 'demo'],
  'paystar-admin': ['review', 'credit', 'treasury', 'servicing', 'legal'],
  'business-admin': ['orders', 'returns', 'checks', 'credit', 'legal'],
  bank: ['underwriting', 'funding', 'purchase', 'collections', 'legal'],
};
const ROLE_PARTY: Record<string, string> = { 'super-admin': 'PAYSTAR', 'paystar-admin': 'PAYSTAR', 'business-admin': 'CLINIC', bank: 'BANK' };

/** Invite a staff user into an organization with one of the staff roles and scoped capabilities. */
export async function createUser(t: Q, actor: Actor, input: any) {
  requireScope(actor, 'organizations');
  const name = String(input.display_name ?? '').trim();
  const role = String(input.role ?? '');
  const errs: { field: string; code: string }[] = [];
  if (name.length < 3) errs.push({ field: 'display_name', code: 'REQUIRED' });
  if (!ROLE_SCOPES[role]) errs.push({ field: 'role', code: 'INVALID' });
  const org = input.organization_id ? await t.one('SELECT * FROM organizations WHERE id=$1', [input.organization_id]) : null;
  if (!org) errs.push({ field: 'organization_id', code: 'REQUIRED' });
  else if (ROLE_SCOPES[role] && org.party_type !== ROLE_PARTY[role]) errs.push({ field: 'organization_id', code: 'ROLE_ORG_MISMATCH' });
  const scopes: string[] = (Array.isArray(input.scopes) ? input.scopes : []).filter((s: string) => (ROLE_SCOPES[role] ?? []).includes(s));
  if (!scopes.length) errs.push({ field: 'scopes', code: 'REQUIRED' });
  if (errs.length) fail('INVALID_MEMBER', 422, 'نام، نقش، سازمان متناسب با نقش و حداقل یک حوزه مجوز لازم است.', errs);
  const id = uuid();
  const mobile = `DEMO-MOBILE-${id.slice(0, 8)}`;
  await t.q('INSERT INTO users(id,model_id,display_name,mobile_token) VALUES ($1,$2,$3,$4)', [id, MODEL_ID, name, mobile]);
  await t.q("INSERT INTO memberships(model_id,user_id,organization_id,role,scopes,status) VALUES ($1,$2,$3,$4,$5,'ACTIVE')", [MODEL_ID, id, org.id, role, JSON.stringify(scopes)]);
  await audit(t, actor, 'member.invited', 'user', id, { role, org: org.id, scopes });
  return { user_id: id, role, organization: org.name };
}

/** Revoke a member: sessions end immediately. The last active super-admin and one's own access cannot be revoked. */
export async function revokeUser(t: Q, actor: Actor, input: any) {
  requireScope(actor, 'organizations');
  const m = await t.one("SELECT m.*, u.display_name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=$1 AND m.status='ACTIVE' AND m.role<>'customer' FOR UPDATE OF m", [input.user_id]);
  if (!m) fail('NOT_FOUND', 404);
  if (m.user_id === actor.userId) fail('CANNOT_REVOKE_SELF', 422, 'نمی‌توانید دسترسی خودتان را لغو کنید.');
  if (m.role === 'super-admin') {
    const n = await t.one("SELECT count(*)::int n FROM memberships WHERE role='super-admin' AND status='ACTIVE'");
    if (n.n <= 1) fail('LAST_SUPER_ADMIN', 422, 'آخرین مدیر ارشد فعال قابل حذف نیست.');
  }
  await t.q("UPDATE memberships SET status='REVOKED', version=version+1, updated_at=now() WHERE id=$1", [m.id]);
  await t.q('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [m.user_id]);
  await audit(t, actor, 'member.revoked', 'user', m.user_id, undefined, String(input.reason ?? ''));
  return { revoked: m.display_name };
}

/** Create a clinic record as DRAFT; a different super-admin activates it (maker/checker). */
export async function createOrganization(t: Q, actor: Actor, input: any) {
  requireScope(actor, 'organizations');
  const name = String(input.name ?? '').trim();
  const legal = String(input.legal_identifier ?? '').trim().toUpperCase();
  const errs: { field: string; code: string }[] = [];
  if (name.length < 3) errs.push({ field: 'name', code: 'REQUIRED' });
  if (!/^DEMO-[A-Z0-9-]{3,}$/.test(legal)) errs.push({ field: 'legal_identifier', code: 'DEMO_ONLY' });
  else if (await t.one('SELECT id FROM organizations WHERE legal_identifier_token=$1', [legal])) errs.push({ field: 'legal_identifier', code: 'DUPLICATE' });
  if (errs.length) fail('INVALID_ORGANIZATION', 422, 'نام و شناسه حقوقی یکتا (با پیشوند DEMO-) لازم است.', errs);
  const id = uuid();
  const slug = String(input.slug ?? '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || `clinic-${id.slice(0, 6)}`;
  if (await t.one('SELECT id FROM organizations WHERE slug=$1', [slug])) fail('INVALID_ORGANIZATION', 422, 'این نشانی ویترین قبلاً استفاده شده است.', [{ field: 'slug', code: 'DUPLICATE' }]);
  await t.q(`INSERT INTO organizations(id,model_id,name,party_type,legal_identifier_token,status,payout_account_token,slug) VALUES ($1,$2,$3,'CLINIC',$4,'DRAFT',$5,$6)`,
    [id, MODEL_ID, name, legal, `MOCK-PAYOUT-${legal}`, slug]);
  await t.q(`INSERT INTO approvals(model_id,resource_type,resource_id,action,payload_hash,proposed_by,status) VALUES ($1,'organization',$2,'ACTIVATE_ORGANIZATION',$3,$4,'PENDING')`,
    [MODEL_ID, id, sha256(JSON.stringify({ name, legal })), actor.userId]);
  await audit(t, actor, 'organization.created_draft', 'organization', id, { name, legal });
  return { organization_id: id, status: 'DRAFT', next: 'فعال‌سازی توسط مدیر ارشد دیگر' };
}

export async function activateOrganization(t: Q, actor: Actor, input: any) {
  // Checker: any super-admin other than the maker (role enforced by the dispatcher).
  const a = await t.one("SELECT * FROM approvals WHERE resource_id=$1 AND action='ACTIVATE_ORGANIZATION' AND status='PENDING' FOR UPDATE", [input.organization_id]);
  if (!a) fail('INVALID_TRANSITION', 409, 'درخواست فعال‌سازی در انتظاری برای این سازمان نیست.');
  assertChecker(a.proposed_by, actor.userId);
  const now = await clock(t);
  await t.q("UPDATE approvals SET status='APPROVED', approved_by=$2, version=version+1, updated_at=now() WHERE id=$1", [a.id, actor.userId]);
  await t.q("UPDATE organizations SET status='ACTIVE', version=version+1, updated_at=now() WHERE id=$1", [a.resource_id]);
  // Starter catalog so the new clinic can sell immediately (same standard dental services, fresh prices).
  await t.q(`INSERT INTO catalog_items(model_id,tenant_id,business_id,external_sku,title,category,price_irr,available,image_url,checkout_url,source_updated_at)
     SELECT DISTINCT ON (external_sku) model_id, $1::uuid, $1::uuid, external_sku, title, category, price_irr, true, image_url, checkout_url, $2::timestamptz FROM catalog_items
      WHERE business_id<>$1 ORDER BY external_sku, source_updated_at DESC
     ON CONFLICT (model_id,business_id,external_sku) DO NOTHING`, [a.resource_id, iso(now)]);
  await audit(t, actor, 'organization.activated', 'organization', a.resource_id);
  return { status: 'ACTIVE' };
}
