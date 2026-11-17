/**
 * Model 4 integration tests: real schema + fixture on an on-disk PGlite directory, commands through
 * the same dispatcher (authorization, idempotency, transactions, webhooks) the HTTP API uses.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'paystar-m4-test-'));
process.env.DATA_DIR = dir;
process.env.MODEL_ID = '4';
process.env.PAYSTAR_ROOT = path.resolve(import.meta.dirname, '..');

let R: typeof import('../src/server/registry');
let DB: typeof import('../src/server/db');
let SV: typeof import('../src/server/services');
const BANK = 'fc3f0eae-e086-5dbe-99a5-54a2614c8b5f';
const CUR_PURCHASE = 'ea1af5c0-7d1f-502a-a7cb-ca59f0b5f601';
const CUR_LINE = 'e621cbf4-d392-5af7-9432-c2cc591522be';
const DRAFT_APP = '2d0977e1-a9a1-5d95-a028-fcc2809b597c';
const CORR_APP = '16c655e3-4ace-51b5-8522-483fbb122fbf';
const OVERDUE_PURCHASE = '71bb0419-fcab-5192-9b8f-6eee4e3dd107';
const CATALOG_400 = '174fec14-f5e6-5b58-b86e-7b29f5190f79';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6S8AAAAASUVORK5CYII=';

before(async () => {
  DB = await import('../src/server/db');
  R = await import('../src/server/registry');
  SV = await import('../src/server/services');
  await DB.getDb();
});
after(async () => { await DB.closeDb(); rmSync(dir, { recursive: true, force: true }); });

const actors: Record<string, any> = {};
async function as(key: string) {
  if (!actors[key]) actors[key] = await R.actorFromToken(await R.demoLogin(key));
  return actors[key];
}
async function run(key: string, cmd: string, input: any, expect = 200, idem?: string) {
  const r = await R.execute(cmd, input, await as(key), idem);
  assert.equal(r.status, expect, `${cmd} as ${key}: ${JSON.stringify(r.body)}`);
  return r.body.result ?? r.body.error;
}
const q = (sql: string, p: unknown[] = []) => DB.tx(null, (t) => t.q(sql, p));
const one = (sql: string, p: unknown[] = []) => DB.tx(null, (t) => t.one(sql, p));
const stmt = (id: string) => DB.tx(null, (t) => SV.statement(t, id));
const line = (id: string) => DB.tx(null, (t) => SV.lineState(t, id));
async function reset() { await R.reset(await as('super'), 'RESET MODEL 4'); for (const k of Object.keys(actors)) delete actors[k]; }
const customerId = async (userKey: string) => (await as(userKey)).customerId;

async function checkoutToFirstPayment(customerKey: string, principal = '400000000', scenario = 'success') {
  const cust = await customerId(customerKey);
  const order = await run('clinic', 'order.create', { customer_id: cust, catalog_item_id: CATALOG_400, financed_principal_irr: principal });
  await run(customerKey, 'checkout.sign_contract', { checkout_id: order.checkout_id, accept: true });
  const checks = order.quote.installments.slice(1).map((i: any) => ({ sequence: i.sequence, sayad_id: `DEMO-SAYAD-T${order.checkout_id.slice(0, 6)}-${i.sequence}`, amount_irr: i.total_irr, beneficiary: BANK }));
  await run(customerKey, 'checkout.register_checks', { checkout_id: order.checkout_id, checks });
  await run('bank', 'checks.bank_accept', { checkout_id: order.checkout_id });
  const pay = await run(customerKey, 'payment.start', { checkout_id: order.checkout_id, scenario });
  return { order, pay };
}

test('seed reproduces the standard example and balanced books', async () => {
  const s = (await stmt(CUR_PURCHASE))!;
  assert.equal(s.totals.outstandingPrincipal, 300000000n);
  assert.equal(s.totals.payoff, 336000000n);
  assert.equal(s.purchase.current_owner_id, BANK);
  const l = (await line(CUR_LINE))!;
  assert.equal(l.available, 100000000n);
  assert.equal(l.spendable, 100000000n);
  const bal = await one("SELECT sum(debit_irr-credit_irr)::bigint b FROM journal_lines");
  assert.equal(bal.b, 0n);
});

test('P0-05/P0-04/P0-06/P0-07/P0-19: fresh application, bank-only decision, contract, checks, first payment, bank payout gate', async () => {
  await reset();
  const app = DRAFT_APP;
  await run('customer-draft', 'application.identity', { application_id: app, otp: '000000', consents: [] }, 422);
  await run('customer-draft', 'application.identity', { application_id: app, otp: '123456', consents: ['IDENTITY', 'ACCOUNT', 'CREDIT_REPORT', 'DATA_PROCESSING'] });
  await run('customer-draft', 'application.account', { application_id: app, card: 'DEMO-CARD-4321' });
  await run('customer-draft', 'application.submit_evidence', { application_id: app }, 422);
  for (const category of ['IDENTITY', 'INCOME']) await run('customer-draft', 'application.document', { application_id: app, category, mime_type: 'image/png', base64: PNG });
  await run('customer-draft', 'application.submit_evidence', { application_id: app });
  const fee = await run('customer-draft', 'application.pay_fee', { application_id: app, scenario: 'success' });
  assert.equal(fee.amount_irr, '500000');
  await run('customer-draft', 'application.pay_fee', { application_id: app }, 409);
  const as1 = await run('customer-draft', 'application.run_assessment', { application_id: app, scenario: 'normal' });
  assert.equal(as1.recommended_limit_irr, '400000000');
  // PayStar cannot take the bank's decision.
  await run('ops', 'decision.bank_final', { application_id: app, outcome: 'APPROVE' }, 403);
  await run('super', 'decision.bank_final', { application_id: app, outcome: 'APPROVE' }, 403);
  await run('ops', 'review.paystar', { application_id: app, outcome: 'APPROVE' });
  await run('ops', 'review.paystar', { application_id: app, outcome: 'APPROVE' }, 409);
  await run('bank', 'decision.bank_final', { application_id: app, outcome: 'CORRECTION', reason_code: 'INCOME_DOC', customer_message: 'مدرک درآمد جدید', fields: ['income_document'] });
  await run('customer-draft', 'application.resubmit', { application_id: app }, 422);
  await run('customer-draft', 'application.document', { application_id: app, category: 'INCOME', mime_type: 'image/png', base64: PNG });
  assert.equal((await run('customer-draft', 'application.resubmit', { application_id: app })).status, 'CREDITOR_REVIEW');
  await run('bank', 'decision.bank_final', { application_id: app, outcome: 'APPROVE', limit_irr: '500000000' }, 422);
  const d = await run('bank', 'decision.bank_final', { application_id: app, outcome: 'APPROVE', limit_irr: '400000000' });
  assert.equal(d.status, 'APPROVED');
  const ln = await one("SELECT * FROM credit_lines WHERE application_id=$1", [app]);
  assert.equal(ln.status, 'APPROVED_PENDING_CONTRACT');
  const cust = await customerId('customer-draft');
  await run('clinic', 'order.create', { customer_id: cust, catalog_item_id: CATALOG_400 }, 422);
  await run('customer-draft', 'line.sign', { credit_line_id: ln.id, accept: true });

  const order = await run('clinic', 'order.create', { customer_id: cust, catalog_item_id: CATALOG_400, financed_principal_irr: '400000000' });
  assert.equal(order.quote.commission_irr, '48000000');
  assert.deepEqual(order.quote.installments.map((i: any) => i.total_irr), ['112000000', '112000000', '112000000', '112000000']);
  await run('customer-draft', 'payment.start', { checkout_id: order.checkout_id }, 409);
  await run('customer-draft', 'checkout.sign_contract', { checkout_id: order.checkout_id, accept: true });
  const good = order.quote.installments.slice(1).map((i: any) => ({ sequence: i.sequence, sayad_id: `DEMO-SAYAD-FRESH-${i.sequence}`, amount_irr: i.total_irr, beneficiary: BANK }));
  await run('customer-draft', 'checkout.register_checks', { checkout_id: order.checkout_id, checks: good.map((c: any) => ({ ...c, beneficiary: 'd2be8100-9ef3-5193-82df-b6c4fa69d2ef' })) }, 422);
  await run('customer-draft', 'checkout.register_checks', { checkout_id: order.checkout_id, checks: good });
  await run('customer-draft', 'payment.start', { checkout_id: order.checkout_id }, 409);
  await run('ops', 'checks.bank_accept', { checkout_id: order.checkout_id }, 403);
  await run('bank', 'checks.bank_accept', { checkout_id: order.checkout_id });
  await run('customer-draft', 'payment.start', { checkout_id: order.checkout_id, scenario: 'success' });
  const p = await one('SELECT * FROM purchases WHERE checkout_id=$1', [order.checkout_id]);
  assert.equal(p.current_owner_id, BANK);
  assert.equal(p.service_status, 'AWAITING_FUNDS');
  const s = (await stmt(p.id))!;
  assert.equal(s.totals.outstandingPrincipal, 300000000n);
  assert.equal(s.totals.payoff, 336000000n, 'early payoff after first payment');
  // Creditor consistency across agreement, checks, payment route and ownership.
  const contract = await one('SELECT creditor_id FROM contracts WHERE checkout_id=$1', [order.checkout_id]);
  assert.equal(contract.creditor_id, BANK);
  for (const c of await q('SELECT beneficiary_id, custodian_id, status FROM checks WHERE purchase_id=$1', [p.id])) { assert.equal(c.beneficiary_id, BANK); assert.equal(c.status, 'IN_CUSTODY'); }
  assert.equal((await one("SELECT creditor_id FROM payment_intents WHERE checkout_id=$1", [order.checkout_id])).creditor_id, BANK);
  const inv = await one('SELECT net_irr FROM invoices WHERE purchase_id=$1', [p.id]);
  assert.equal(inv.net_irr, 3000000n);
  // Service gate and bank-only disbursement with maker/checker.
  await run('clinic', 'service.start', { purchase_id: p.id }, 422);
  const settlement = await one('SELECT * FROM settlements WHERE purchase_id=$1', [p.id]);
  assert.equal(settlement.amount_irr, 400000000n, 'clinic receives full P, not 300m');
  await run('ops', 'disbursement.propose', { settlement_id: settlement.id }, 403);
  await run('super', 'disbursement.approve', { approval_id: settlement.id }, 403);
  const prop = await run('bank', 'disbursement.propose', { settlement_id: settlement.id });
  await run('bank', 'disbursement.approve', { approval_id: prop.approval_id }, 409);
  await run('bank-checker', 'disbursement.approve', { approval_id: prop.approval_id, scenario: 'unknown' });
  assert.equal((await one('SELECT status FROM settlements WHERE id=$1', [settlement.id])).status, 'UNKNOWN');
  await run('clinic', 'service.start', { purchase_id: p.id }, 422);
  await run('bank', 'disbursement.inquire', { settlement_id: settlement.id });
  await run('bank', 'disbursement.inquire', { settlement_id: settlement.id });
  assert.equal((await one('SELECT status FROM settlements WHERE id=$1', [settlement.id])).status, 'CONFIRMED');
  assert.equal((await one("SELECT count(*)::int n FROM journals WHERE event_key=$1", [`CLINIC_PAID:${settlement.id}`])).n, 1);
  await run('clinic', 'service.start', { purchase_id: p.id });
});

test('P0-09: next payment reduces principal to 200m; duplicate webhook changes nothing', async () => {
  await reset();
  const r = await run('customer-current', 'payment.start', { purchase_id: CUR_PURCHASE, count: 1, scenario: 'duplicate' });
  assert.equal(r.amount_irr, '112000000');
  let s = (await stmt(CUR_PURCHASE))!;
  assert.equal(s.totals.outstandingPrincipal, 200000000n);
  const receipts = (await one('SELECT count(*)::int n FROM payment_receipts')).n;
  const journals = (await one('SELECT count(*)::int n FROM journals')).n;
  await run('ops', 'payment.replay_webhook', { intent_id: r.intent_id });
  s = (await stmt(CUR_PURCHASE))!;
  assert.equal(s.totals.outstandingPrincipal, 200000000n);
  assert.equal((await one('SELECT count(*)::int n FROM payment_receipts')).n, receipts);
  assert.equal((await one('SELECT count(*)::int n FROM journals')).n, journals);
  assert.equal((await line(CUR_LINE))!.available, 200000000n);
  const ln = await one('SELECT outstanding_principal_irr FROM credit_lines WHERE id=$1', [CUR_LINE]);
  assert.equal(ln.outstanding_principal_irr, 200000000n);
  // Idempotency-Key: same key + same body returns original; different body conflicts.
  const a = await R.execute('support.create', { case_type: 'GENERAL', summary: 'x' }, await as('customer-current'), 'k1');
  const b = await R.execute('support.create', { case_type: 'GENERAL', summary: 'x' }, await as('customer-current'), 'k1');
  assert.equal(a.body.reference, b.body.reference);
  assert.equal((await R.execute('support.create', { case_type: 'GENERAL', summary: 'y' }, await as('customer-current'), 'k1')).status, 409);
});

test('P0-10: unknown payment stays pending; late success after expiry is unapplied, no revival', async () => {
  await reset();
  const r = await run('customer-current', 'payment.start', { purchase_id: CUR_PURCHASE, count: 1, scenario: 'unknown' });
  assert.equal((await one('SELECT status FROM payment_intents WHERE id=$1', [r.intent_id])).status, 'UNKNOWN');
  assert.equal((await stmt(CUR_PURCHASE))!.totals.outstandingPrincipal, 300000000n);
  await run('customer-current', 'payment.start', { purchase_id: CUR_PURCHASE, count: 1 }, 409);
  await run('customer-current', 'payment.inquire', { intent_id: r.intent_id });
  assert.equal((await stmt(CUR_PURCHASE))!.totals.outstandingPrincipal, 200000000n);

  await reset();
  const { order, pay } = await checkoutToFirstPayment('customer-current', '100000000', 'unknown');
  await run('super', 'clock.advance', { minutes: 16 });
  assert.equal((await one('SELECT status FROM checkouts WHERE id=$1', [order.checkout_id])).status, 'EXPIRED');
  assert.equal((await one('SELECT reserved_principal_irr FROM credit_lines WHERE id=$1', [CUR_LINE])).reserved_principal_irr, 0n);
  await run('customer-current', 'payment.inquire', { intent_id: pay.intent_id });
  assert.equal((await one('SELECT count(*)::int n FROM purchases WHERE checkout_id=$1', [order.checkout_id])).n, 0);
  assert.equal((await one('SELECT status FROM payment_receipts WHERE intent_id=$1', [pay.intent_id])).status, 'UNAPPLIED');
  assert.equal((await line(CUR_LINE))!.available, 100000000n);
});

test('P0-11: two concurrent checkouts at the cap — at most the allowed exposure commits', async () => {
  await reset();
  const cust = await customerId('customer-current');
  const [a, b] = await Promise.all([
    R.execute('order.create', { customer_id: cust, catalog_item_id: CATALOG_400, financed_principal_irr: '100000000' }, await as('clinic')),
    R.execute('order.create', { customer_id: cust, catalog_item_id: CATALOG_400, financed_principal_irr: '100000000' }, await as('clinic')),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 422]);
  const l = (await line(CUR_LINE))!;
  assert.equal(l.available, 0n);
  assert.ok(l.available >= 0n);
});

test('P0-12/P0-14: half return then full return, distinct clinic checker, repeat is zero, bank amendment', async () => {
  await reset();
  await run('customer-current', 'return.request', { purchase_id: CUR_PURCHASE, return_principal_irr: '200000000', reason: 'x' }, 403);
  const req = await run('clinic', 'return.request', { purchase_id: CUR_PURCHASE, return_principal_irr: '200000000', reason: 'نیمی از خدمت لغو شد' });
  assert.equal(req.preview.wallet_refund_irr, '56000000');
  await run('clinic', 'return.approve', { refund_id: req.refund_id }, 409);
  await run('other-clinic', 'return.approve', { refund_id: req.refund_id }, 404);
  const ap = await run('clinic-checker', 'return.approve', { refund_id: req.refund_id });
  assert.equal(ap.wallet_refund_irr, '56000000');
  assert.equal(ap.principal_released_irr, '150000000');
  let s = (await stmt(CUR_PURCHASE))!;
  assert.equal(s.totals.outstandingPrincipal, 150000000n);
  for (const i of s.installments.slice(1)) assert.equal(i.principal_cancelled_irr + i.commission_cancelled_irr, 56000000n);
  const again = await run('clinic-checker', 'return.approve', { refund_id: req.refund_id });
  assert.equal(again.duplicate, true);
  const req2 = await run('clinic', 'return.request', { purchase_id: CUR_PURCHASE, return_principal_irr: '200000000', reason: 'لغو کامل' });
  const ap2 = await run('clinic-checker', 'return.approve', { refund_id: req2.refund_id });
  assert.equal(ap2.wallet_refund_irr, '56000000');
  assert.equal(ap2.principal_released_irr, '150000000');
  s = (await stmt(CUR_PURCHASE))!;
  assert.equal(s.totals.outstandingPrincipal, 0n);
  assert.equal(s.totals.refundedPrincipal + s.totals.refundedCommission, 112000000n);
  assert.equal((await one('SELECT funded_irr FROM wallets WHERE customer_id=$1', [await customerId('customer-current')])).funded_irr, 112000000n);
  await run('clinic', 'return.request', { purchase_id: CUR_PURCHASE, return_principal_irr: '10', reason: 'x' }, 409);
  assert.equal((await line(CUR_LINE))!.available, 400000000n);
  assert.equal((await one("SELECT reversed_irr FROM invoices WHERE purchase_id=$1", [CUR_PURCHASE])).reversed_irr, 3000000n);
  const amend = await q("SELECT * FROM bank_instructions WHERE purchase_id=$1 AND instruction_type='REFUND_AMENDMENT' AND status='PENDING' ORDER BY created_at DESC", [CUR_PURCHASE]);
  assert.equal(amend.length, 2);
  await run('ops', 'amendment.bank_ack', { instruction_id: amend[0].id }, 403);
  const ack = await run('bank', 'amendment.bank_ack', { instruction_id: amend[0].id });
  assert.equal(ack.acknowledged_balance_irr, '0');
  assert.equal((await one("SELECT count(*)::int n FROM checks WHERE purchase_id=$1 AND status='RELEASED'", [CUR_PURCHASE])).n, 3);
});

test('P0-13: wallet owed/funded/held; unknown payout held then confirmed; failure releases hold', async () => {
  await reset();
  const key = 'customer-refunded';
  const acct = await one('SELECT id FROM bank_accounts WHERE owner_user_id=$1', [(await as(key)).userId]);
  await run(key, 'wallet.withdraw', { amount_irr: '200000000', bank_account_id: acct.id }, 422);
  const f = await run(key, 'wallet.withdraw', { amount_irr: '12000000', bank_account_id: acct.id, scenario: 'failed' });
  let w = await one('SELECT * FROM wallets WHERE customer_id=$1', [await customerId(key)]);
  assert.equal(w.held_irr, 0n); assert.equal(w.funded_irr, 112000000n);
  const u = await run(key, 'wallet.withdraw', { amount_irr: '112000000', bank_account_id: acct.id, scenario: 'unknown' });
  w = await one('SELECT * FROM wallets WHERE customer_id=$1', [await customerId(key)]);
  assert.equal(w.held_irr, 112000000n);
  await run(key, 'wallet.withdraw', { amount_irr: '10000', bank_account_id: acct.id }, 422);
  await run(key, 'wallet.inquire', { withdrawal_id: u.withdrawal_id });
  w = await one('SELECT * FROM wallets WHERE customer_id=$1', [await customerId(key)]);
  assert.equal(w.held_irr, 0n); assert.equal(w.funded_irr, 0n); assert.equal(w.liability_irr, 0n);
  assert.ok(f.withdrawal_id);
});

test('P0-20: overdue blocks spend; guarantee order and caps enforced; PayStar mandate stops at DPD29', async () => {
  await reset();
  await run('super', 'clock.advance', { minutes: 1 });
  const ov = await customerId('customer-overdue');
  await run('clinic', 'order.create', { customer_id: ov, catalog_item_id: CATALOG_400, financed_principal_irr: '10000000' }, 422);
  const c = await one('SELECT * FROM collection_cases WHERE purchase_id=$1', [OVERDUE_PURCHASE]);
  assert.ok(c.dpd >= 60);
  await run('ops', 'collections.log_contact', { case_id: c.id }, 403);
  await run('ops', 'collections.authorize_legal', { case_id: c.id }, 403);
  const pre = await run('bank', 'guarantee.propose_claim', { case_id: c.id }, 422);
  assert.ok(pre.field_errors.length >= 3);
  await run('bank-checker', 'collections.authorize_legal', { case_id: c.id });
  await run('bank', 'collections.record_recovery', { case_id: c.id, action_type: 'CUSTOMER_RECOVERY_ATTEMPT' });
  await run('bank', 'collections.record_recovery', { case_id: c.id, action_type: 'CHECK_PRESENTATION', result_code: 'BOUNCED' });
  await run('bank', 'guarantee.propose_claim', { case_id: c.id }, 422);
  await run('super', 'clock.advance', { days: 15 });
  const claim = await run('bank', 'guarantee.propose_claim', { case_id: c.id });
  assert.equal(claim.requested_irr, '60000000', '20% of 300m residual principal');
  await run('bank', 'guarantee.approve_claim', { claim_id: claim.claim_id }, 403);
  await run('bank-checker', 'guarantee.approve_claim', { claim_id: claim.claim_id });
  await run('other-clinic', 'guarantee.pay_claim', { claim_id: claim.claim_id }, 404);
  await run('clinic', 'guarantee.pay_claim', { claim_id: claim.claim_id });
  assert.equal((await stmt(OVERDUE_PURCHASE))!.totals.outstandingPrincipal, 300000000n, 'guarantee does not discharge customer debt');
  const g = await one('SELECT used_irr, reserved_claim_irr FROM guarantees');
  assert.equal(g.used_irr, 60000000n); assert.equal(g.reserved_claim_irr, 0n);
});

test('P0-21/P0-22: isolation and immutable balanced ledger', async () => {
  await reset();
  await run('other-clinic', 'service.start', { purchase_id: CUR_PURCHASE }, 404);
  await run('customer-overdue', 'payment.start', { purchase_id: CUR_PURCHASE, count: 1 }, 404);
  await run('customer-current', 'application.resubmit', { application_id: CORR_APP }, 404);
  await run('other-clinic', 'order.create', { customer_id: await customerId('customer-current'), catalog_item_id: CATALOG_400 }, 404);
  await assert.rejects(DB.tx(null, (t) => t.q("UPDATE journals SET source_type='X' WHERE status='POSTED'")));
  await assert.rejects(DB.tx(null, (t) => t.q('DELETE FROM journal_lines')));
  await run('ops', 'decision.bank_final', { application_id: CORR_APP, outcome: 'APPROVE' }, 403);
  const denied = await one("SELECT count(*)::int n FROM audit_events WHERE action LIKE 'denied:%'");
  assert.ok(denied.n >= 1);
  const books = await q("SELECT j.book_party_id, sum(l.debit_irr-l.credit_irr)::bigint b FROM journals j JOIN journal_lines l ON l.journal_id=j.id GROUP BY 1");
  for (const b of books) assert.equal(b.b, 0n);
});

test('P0-02: persistence across close/reopen of the on-disk database', async () => {
  await reset();
  await run('customer-current', 'payment.start', { purchase_id: CUR_PURCHASE, count: 1 });
  await DB.closeDb();
  await DB.getDb();
  assert.equal((await stmt(CUR_PURCHASE))!.totals.outstandingPrincipal, 200000000n);
});

test('real workflow: new customer registers → one-form request → PayStar approves → bank approves → signs → credit available', async () => {
  await reset();
  const reg = await R.register({ token: 'DEMO-REFERRAL-TOKEN', first_name: 'سمیرا', last_name: 'قاسمی', national_id: 'DEMO-NID-samira', mobile: 'DEMO-MOBILE-samira', birth_date: '1992-05-10' });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  const me = (await R.actorFromToken(reg.body.token))!;
  assert.equal(me.displayName, 'سمیرا قاسمی');
  const call = async (cmd: string, input: any, expect = 200) => { const r = await R.execute(cmd, input, me); assert.equal(r.status, expect, `${cmd}: ${JSON.stringify(r.body)}`); return r.body.result; };
  await call('application.start', {}, 409); // already has an open draft from registration
  const app = (await one('SELECT id FROM applications WHERE customer_id=$1', [me.customerId])).id;
  await call('application.identity', { application_id: app, otp: '123456', consents: ['IDENTITY', 'ACCOUNT', 'CREDIT_REPORT', 'DATA_PROCESSING'] });
  await call('application.account', { application_id: app, card: 'DEMO-CARD-1234' });
  for (const category of ['IDENTITY', 'INCOME']) await call('application.document', { application_id: app, category, sample: true });
  await call('application.submit_evidence', { application_id: app });
  await call('application.pay_fee', { application_id: app, scenario: 'success' });
  await call('application.run_assessment', { application_id: app, scenario: 'normal' });
  assert.equal((await one('SELECT status FROM applications WHERE id=$1', [app])).status, 'PAYSTAR_REVIEW');
  await run('ops', 'review.paystar', { application_id: app, outcome: 'APPROVE' });
  assert.equal((await one('SELECT status FROM applications WHERE id=$1', [app])).status, 'CREDITOR_REVIEW');
  await run('bank', 'decision.bank_final', { application_id: app, outcome: 'APPROVE', limit_irr: '400000000' });
  const ln = await one('SELECT * FROM credit_lines WHERE customer_id=$1', [me.customerId]);
  assert.equal(ln.status, 'APPROVED_PENDING_CONTRACT');
  assert.equal((await line(ln.id))!.spendable, 0n, 'not spendable before the bank agreement is signed');
  await call('line.sign', { credit_line_id: ln.id, accept: true });
  const l = (await line(ln.id))!;
  assert.equal(l.line.status, 'ACTIVE');
  assert.equal(l.spendable, 400000000n);
  await call('application.start', {}, 409); // active line blocks a second application
});

test('S1: super-admin invites users and registers a clinic with maker/checker; revoke ends access', async () => {
  await reset();
  const BANK = 'fc3f0eae-e086-5dbe-99a5-54a2614c8b5f';
  const u = await run('super', 'member.create', { display_name: 'نازنین فرهادی', role: 'bank', organization_id: BANK, scopes: ['underwriting', 'orders'] });
  const m = await one('SELECT scopes FROM memberships WHERE user_id=$1', [u.user_id]);
  assert.deepEqual(m.scopes, ['underwriting'], 'scopes outside the role are dropped');
  await run('super', 'member.create', { display_name: 'خطا', role: 'bank', organization_id: '53c1a926-518d-5ac4-a7bf-16645a00feb2', scopes: ['underwriting'] }, 422);
  await run('ops', 'member.create', { display_name: 'x', role: 'bank', organization_id: BANK, scopes: ['underwriting'] }, 403);
  // The invited bank user can log in and act with bank authority.
  const tok = await R.demoLogin(u.user_id);
  const nb = (await R.actorFromToken(tok))!;
  assert.equal(nb.role, 'bank');
  // Clinic: DRAFT → same super cannot activate → checker activates → starter catalog exists.
  const c = await run('super', 'organization.create', { name: 'کلینیک دندان‌پزشکی مهر', legal_identifier: 'DEMO-CLINIC-C', slug: 'mehr' });
  await run('super', 'organization.create', { name: 'تکراری', legal_identifier: 'DEMO-CLINIC-C' }, 422);
  await run('super', 'organization.activate', { organization_id: c.organization_id }, 409);
  await run('super-checker', 'organization.activate', { organization_id: c.organization_id });
  assert.equal((await one('SELECT status FROM organizations WHERE id=$1', [c.organization_id])).status, 'ACTIVE');
  assert.ok((await one('SELECT count(*)::int n FROM catalog_items WHERE business_id=$1', [c.organization_id])).n >= 1);
  // Revoke: session dies, login refused; self-revoke refused.
  await run('super', 'member.revoke', { user_id: u.user_id });
  assert.equal(await R.actorFromToken(tok), null);
  await assert.rejects(R.demoLogin(u.user_id));
  await run('super', 'member.revoke', { user_id: (await as('super')).userId }, 422);
});

test('customer-chosen terms: 25m toman in 6 installments flows through recommendation, bank, checkout, checks and returns', async () => {
  await reset();
  const reg = await R.register({ token: 'DEMO-REFERRAL-TOKEN', first_name: 'آرش', last_name: 'شش‌قسطی', national_id: 'DEMO-NID-six', mobile: 'DEMO-MOBILE-six', birth_date: '1990-02-02' });
  const me = (await R.actorFromToken(reg.body.token))!;
  const call = async (cmd: string, input: any, expect = 200) => { const r = await R.execute(cmd, input, me); assert.equal(r.status, expect, `${cmd}: ${JSON.stringify(r.body)}`); return r.body.result ?? r.body.error; };
  const app = (await one('SELECT id FROM applications WHERE customer_id=$1', [me.customerId])).id;
  await call('application.terms', { application_id: app, requested_limit_irr: '250000000', installment_count: 5 }, 422);
  await call('application.terms', { application_id: app, requested_limit_irr: '410000000', installment_count: 6 }, 422);
  await call('application.terms', { application_id: app, requested_limit_irr: '255000000', installment_count: 6 }, 422);
  await call('application.terms', { application_id: app, requested_limit_irr: '250000000', installment_count: 6 });
  await call('application.identity', { application_id: app, otp: '123456', consents: ['IDENTITY', 'ACCOUNT', 'CREDIT_REPORT', 'DATA_PROCESSING'] });
  await call('application.account', { application_id: app, card: 'DEMO-CARD-6666' });
  for (const category of ['IDENTITY', 'INCOME']) await call('application.document', { application_id: app, category, sample: true });
  await call('application.submit_evidence', { application_id: app });
  await call('application.pay_fee', { application_id: app, scenario: 'success' });
  const as = await call('application.run_assessment', { application_id: app, scenario: 'normal' });
  assert.equal(as.recommended_limit_irr, '250000000', 'recommendation never exceeds the requested amount');
  await call('application.terms', { application_id: app, requested_limit_irr: '400000000', installment_count: 4 }, 409);
  await run('ops', 'review.paystar', { application_id: app, outcome: 'APPROVE' });
  await run('bank', 'decision.bank_final', { application_id: app, outcome: 'APPROVE', limit_irr: '260000000' }, 422);
  await run('bank', 'decision.bank_final', { application_id: app, outcome: 'APPROVE', limit_irr: '250000000' });
  const ln = await one('SELECT * FROM credit_lines WHERE customer_id=$1', [me.customerId]);
  assert.equal(ln.installment_count, 6);
  await call('line.sign', { credit_line_id: ln.id, accept: true });
  // Clinic sells 25m toman; the quote follows the line's 6 installments with a flat 12% commission.
  const order = await run('clinic', 'order.create', { customer_id: me.customerId, catalog_item_id: CATALOG_400, financed_principal_irr: '250000000' });
  assert.equal(order.quote.installments.length, 6);
  assert.equal(order.quote.commission_irr, '30000000');
  assert.deepEqual(order.quote.installments.map((i: any) => i.total_irr), ['46666666', '46666666', '46666666', '46666666', '46666666', '46666670']);
  await call('checkout.sign_contract', { checkout_id: order.checkout_id, accept: true });
  const checks = order.quote.installments.slice(1).map((i: any) => ({ sequence: i.sequence, sayad_id: `DEMO-SAYAD-SIX-${i.sequence}`, amount_irr: i.total_irr, beneficiary: BANK }));
  assert.equal(checks.length, 5);
  await call('checkout.register_checks', { checkout_id: order.checkout_id, checks });
  await run('bank', 'checks.bank_accept', { checkout_id: order.checkout_id });
  await call('payment.start', { checkout_id: order.checkout_id, scenario: 'success' });
  const p = await one('SELECT * FROM purchases WHERE checkout_id=$1', [order.checkout_id]);
  const s = (await stmt(p.id))!;
  assert.equal(s.installments.length, 6);
  assert.equal(s.totals.outstandingPrincipal, 250000000n - 41666666n);
  // Bank disbursement needs all 5 checks in custody, then full P goes to the clinic.
  const settlement = await one('SELECT * FROM settlements WHERE purchase_id=$1', [p.id]);
  const prop = await run('bank', 'disbursement.propose', { settlement_id: settlement.id });
  await run('bank-checker', 'disbursement.approve', { approval_id: prop.approval_id });
  assert.equal((await one('SELECT status FROM settlements WHERE id=$1', [settlement.id])).status, 'CONFIRMED');
  // Full return right after the first payment refunds exactly that payment and releases the rest.
  const req = await run('clinic', 'return.request', { purchase_id: p.id, return_principal_irr: '250000000', reason: 'لغو کامل' });
  const ap = await run('clinic-checker', 'return.approve', { refund_id: req.refund_id });
  assert.equal(ap.wallet_refund_irr, '46666666');
  assert.equal(ap.principal_released_irr, String(250000000n - 41666666n));
  assert.equal((await stmt(p.id))!.totals.outstandingPrincipal, 0n);
});
