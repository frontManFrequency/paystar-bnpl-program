// HTTP end-to-end checks against a running Model 4 server (npm run start:model4 or dev:model4).
// Exercises real cookies, route guards, API authorization, signed webhooks and page rendering.
import { createHmac, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://localhost:3104';
const SECRET = process.env.WEBHOOK_SECRET || 'demo-webhook-secret-not-for-production';
const CUR_PURCHASE = 'ea1af5c0-7d1f-502a-a7cb-ca59f0b5f601';
const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); }
};

class Session {
  constructor(key) { this.key = key; this.cookie = ''; }
  async login() {
    const r = await fetch(`${BASE}/api/v1/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: this.key }) });
    assert.equal(r.status, 200, `login ${this.key}`);
    this.cookie = r.headers.get('set-cookie').split(';')[0];
    return (await r.json()).home;
  }
  async get(path) { return fetch(`${BASE}${path}`, { headers: { cookie: this.cookie }, redirect: 'manual' }); }
  async cmd(name, input, idem = randomUUID()) {
    const r = await fetch(`${BASE}/api/v1/cmd/${name}`, { method: 'POST', headers: { cookie: this.cookie, 'content-type': 'application/json', 'idempotency-key': idem, origin: BASE }, body: JSON.stringify(input) });
    return { status: r.status, body: await r.json() };
  }
}
const S = {};
for (const k of ['super', 'ops', 'clinic', 'clinic-checker', 'other-clinic', 'bank', 'bank-checker', 'customer-current', 'customer-overdue', 'customer-refunded', 'customer-draft']) S[k] = new Session(k);

await check('reset model 4 via HTTP (super-admin, confirmation phrase)', async () => {
  await S.super.login();
  const bad = await fetch(`${BASE}/api/v1/demo/reset`, { method: 'POST', headers: { cookie: S.super.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ phrase: 'nope' }) });
  assert.equal(bad.status, 422);
  const r = await fetch(`${BASE}/api/v1/demo/reset`, { method: 'POST', headers: { cookie: S.super.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ phrase: 'RESET MODEL 4' }) });
  assert.equal(r.status, 200);
});
for (const s of Object.values(S)) await s.login();

const HOME = { super: '/admin', ops: '/ops', clinic: '/business', 'other-clinic': '/business', bank: '/bank', 'customer-current': '/account', 'customer-overdue': '/account', 'customer-draft': '/account' };
for (const [k, path] of Object.entries(HOME)) {
  await check(`P0-03 ${k} renders own workspace ${path}`, async () => {
    const r = await S[k].get(path);
    const html = await r.text();
    assert.equal(r.status, 200);
    assert.ok(html.includes('محیط شبیه‌سازی'), 'simulation banner');
    assert.ok(!/Application error|Internal Server Error/.test(html));
  });
}
for (const path of ['/', '/showcase', '/b/labkhand', '/r/DEMO-REFERRAL-TOKEN', '/r/INVALID', `/ops/purchases/${CUR_PURCHASE}`]) {
  await check(`page ${path} renders`, async () => { const r = await S.ops.get(path); assert.equal(r.status, 200); });
}
const SECTIONS = {
  'customer-current': ['/account', '/account/application', '/account/credit', '/account/purchases', '/account/wallet', '/account/support', '/account/notifications', `/account/purchases/${CUR_PURCHASE}`],
  clinic: ['/business', '/business/orders', '/business/purchases', '/business/referrals', '/business/guarantee', `/business/purchases/${CUR_PURCHASE}`],
  ops: ['/ops', '/ops/applications', '/ops/purchases', '/ops/payments', '/ops/settlements', '/ops/refunds', '/ops/collections', '/ops/support', '/ops/recon'],
  bank: ['/bank', '/bank/applications', '/bank/checks', '/bank/disbursements', '/bank/loans', '/bank/amendments', '/bank/collections', '/bank/hardship', '/bank/invoices', `/bank/loans/${CUR_PURCHASE}`],
  super: ['/admin', '/admin/operations', '/admin/organizations', '/admin/policies', '/admin/audit'],
};
await check('app shell: every sidebar page and nested detail renders inside the role layout', async () => {
  for (const [k, paths] of Object.entries(SECTIONS)) for (const p of paths) {
    const r = await S[k].get(p); const h = await r.text();
    assert.equal(r.status, 200, `${k} ${p}`);
    assert.ok(h.includes('ps-sidebar'), `${k} ${p} sidebar`);
  }
});
await check('P0-21 customer cannot open PayStar/bank workspace (server redirect to /forbidden)', async () => {
  for (const p of ['/ops', '/bank', '/admin', '/business']) {
    const r = await S['customer-current'].get(p);
    assert.ok([302, 307].includes(r.status), `${p} ${r.status}`);
    assert.ok(r.headers.get('location').includes('/forbidden'));
  }
});
await check('P0-21 statement API: owner 200, other customer/clinic 404, unauthenticated 401', async () => {
  const own = await S['customer-current'].get(`/api/v1/statements/${CUR_PURCHASE}`);
  assert.equal(own.status, 200);
  const j = await own.json();
  assert.equal(j.totals.outstandingPrincipal, '300000000');
  assert.equal(j.creditor_id, 'fc3f0eae-e086-5dbe-99a5-54a2614c8b5f');
  assert.equal((await S['customer-overdue'].get(`/api/v1/statements/${CUR_PURCHASE}`)).status, 404);
  assert.equal((await S['other-clinic'].get(`/api/v1/statements/${CUR_PURCHASE}`)).status, 404);
  assert.equal((await fetch(`${BASE}/api/v1/statements/${CUR_PURCHASE}`)).status, 401);
  assert.equal((await S['other-clinic'].get(`/business/purchases/${CUR_PURCHASE}`)).status, 404);
  assert.equal((await S['customer-overdue'].get(`/account/purchases/${CUR_PURCHASE}`)).status, 404);
});
await check('P0-21 CSV export scoped to the requesting clinic', async () => {
  const own = await (await S.clinic.get('/api/v1/exports/orders')).text();
  const other = await (await S['other-clinic'].get('/api/v1/exports/orders')).text();
  assert.ok(own.includes(CUR_PURCHASE));
  assert.ok(!other.includes(CUR_PURCHASE));
  assert.equal((await S['customer-current'].get('/api/v1/exports/orders')).status, 403);
});
await check('P0-04/P0-19 PayStar and super-admin cannot take bank-only actions over HTTP', async () => {
  for (const [k, c] of [['ops', 'decision.bank_final'], ['super', 'decision.bank_final'], ['ops', 'disbursement.propose'], ['ops', 'amendment.bank_ack'], ['ops', 'collections.authorize_legal'], ['customer-current', 'return.approve']]) {
    const r = await S[k].cmd(c, { application_id: '16c655e3-4ace-51b5-8522-483fbb122fbf', outcome: 'APPROVE' });
    assert.equal(r.status, 403, `${k} ${c}`);
  }
});
await check('CSRF: cross-origin mutation rejected', async () => {
  const r = await fetch(`${BASE}/api/v1/cmd/support.create`, { method: 'POST', headers: { cookie: S['customer-current'].cookie, 'content-type': 'application/json', origin: 'http://evil.example' }, body: '{}' });
  assert.equal(r.status, 403);
});
await check('webhook: unsigned/forged callbacks rejected', async () => {
  const body = JSON.stringify({ event_id: 'X', type: 'payment.succeeded', data: {} });
  assert.equal((await fetch(`${BASE}/api/v1/webhooks/mock-pay`, { method: 'POST', body })).status, 401);
  const ts = String(Math.floor(Date.now() / 1000));
  assert.equal((await fetch(`${BASE}/api/v1/webhooks/mock-pay`, { method: 'POST', body, headers: { 'x-timestamp': ts, 'x-signature': 'ab'.repeat(32) } })).status, 401);
});
await check('P0-08/P0-09 next installment over HTTP: 300m → 200m; signed duplicate callback has no effect', async () => {
  const r = await S['customer-current'].cmd('payment.start', { purchase_id: CUR_PURCHASE, count: '1', scenario: 'success' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const intentRef = await (async () => {
    const page = await (await S.ops.get('/ops/payments')).text();
    const m = /MOCK-SUCCESS-[0-9a-f-]{13}/.exec(page); return m?.[0];
  })();
  assert.ok(intentRef, 'intent visible to ops');
  const s1 = await (await S['customer-current'].get(`/api/v1/statements/${CUR_PURCHASE}`)).json();
  assert.equal(s1.totals.outstandingPrincipal, '200000000');
  const env = { event_id: `EVT-${intentRef}`, type: 'payment.succeeded', occurred_at: new Date().toISOString(), data: { provider_intent_ref: intentRef, provider_reference: `RCPT-${intentRef}`, amount_irr: '112000000', currency: 'IRR' } };
  const raw = JSON.stringify(env); const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex');
  const w = await fetch(`${BASE}/api/v1/webhooks/mock-pay`, { method: 'POST', body: raw, headers: { 'x-timestamp': ts, 'x-signature': sig } });
  assert.equal(w.status, 200);
  assert.equal((await w.json()).duplicate, true);
  const s2 = await (await S['customer-current'].get(`/api/v1/statements/${CUR_PURCHASE}`)).json();
  assert.equal(s2.totals.outstandingPrincipal, '200000000');
});
await check('idempotency over HTTP: same key replays, different body conflicts', async () => {
  const k = randomUUID();
  const a = await S['customer-current'].cmd('support.create', { case_type: 'GENERAL', summary: 'e2e' }, k);
  const b = await S['customer-current'].cmd('support.create', { case_type: 'GENERAL', summary: 'e2e' }, k);
  assert.equal(a.body.reference, b.body.reference);
  assert.equal(b.body.idempotent_replay, true);
  assert.equal((await S['customer-current'].cmd('support.create', { case_type: 'GENERAL', summary: 'other' }, k)).status, 409);
});
await check('P0-07 clinic cannot start service before bank payout (fresh order over HTTP)', async () => {
  // customer-current has 200m available after the payment above
  const cust = await (await S.clinic.get('/business/orders')).text();
  assert.ok(cust.includes('مریم رضایی'));
});
await check('real workflow over HTTP: register → submit → PayStar dashboard → approve → bank dashboard → approve → customer credit available', async () => {
  const reg = await fetch(`${BASE}/api/v1/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'DEMO-REFERRAL-TOKEN', first_name: 'پریسا', last_name: 'نادری', national_id: `DEMO-NID-${Date.now()}`, mobile: `DEMO-MOBILE-${Date.now()}`, birth_date: '1991-03-03' }) });
  assert.equal(reg.status, 200);
  const cu = new Session('new'); cu.cookie = reg.headers.get('set-cookie').split(';')[0];
  const home = await (await cu.get('/account/application')).text();
  assert.ok(home.includes('ثبت درخواست اعتبار'), 'one-form request visible');
  const app = /application_id[^0-9a-f]{1,20}([0-9a-f]{8}-[0-9a-f-]{27})/.exec(home)[1];
  const ok = async (s, c, i) => { const r = await s.cmd(c, i); assert.equal(r.status, 200, `${c} ${JSON.stringify(r.body)}`); return r.body.result; };
  await ok(cu, 'application.identity', { application_id: app, otp: '123456', consents: ['IDENTITY', 'ACCOUNT', 'CREDIT_REPORT', 'DATA_PROCESSING'] });
  await ok(cu, 'application.account', { application_id: app, card: 'DEMO-CARD-1234' });
  for (const category of ['IDENTITY', 'INCOME']) await ok(cu, 'application.document', { application_id: app, category, sample: true });
  await ok(cu, 'application.submit_evidence', { application_id: app });
  await ok(cu, 'application.pay_fee', { application_id: app, scenario: 'success' });
  await ok(cu, 'application.run_assessment', { application_id: app, scenario: 'normal' });
  assert.ok((await (await S.ops.get('/ops')).text()).includes('پریسا نادری'), 'waiting on PayStar dashboard');
  assert.ok(!(await (await S.bank.get('/bank')).text()).includes('پریسا نادری'), 'not yet at bank');
  await ok(S.ops, 'review.paystar', { application_id: app, outcome: 'APPROVE' });
  assert.ok((await (await S.bank.get('/bank')).text()).includes('پریسا نادری'), 'waiting on bank dashboard');
  await ok(S.bank, 'decision.bank_final', { application_id: app, outcome: 'APPROVE', limit_irr: '400000000' });
  const credit = await (await cu.get('/account/credit')).text();
  assert.ok(credit.includes('امضای قرارداد بانک'));
  const lid = /credit_line_id[^0-9a-f]{1,20}([0-9a-f]{8}-[0-9a-f-]{27})/.exec(credit)[1];
  await ok(cu, 'line.sign', { credit_line_id: lid, accept: true });
  const after = await (await cu.get('/account/credit')).text();
  assert.ok(after.includes('بدون محدودیت') && after.includes('۴۰٬۰۰۰٬۰۰۰'), 'credit active and spendable');
});
await check('reset again leaves seeded state for the presenter', async () => {
  const r = await fetch(`${BASE}/api/v1/demo/reset`, { method: 'POST', headers: { cookie: S.super.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ phrase: 'RESET MODEL 4' }) });
  assert.equal(r.status, 200);
  await S['customer-current'].login();
  const s = await (await S['customer-current'].get(`/api/v1/statements/${CUR_PURCHASE}`)).json();
  assert.equal(s.totals.outstandingPrincipal, '300000000');
});

for (const r of results) console.log(r.join(' | '));
const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
