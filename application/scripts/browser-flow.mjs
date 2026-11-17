// Real-browser click-through of the credit workflow (local Chrome via puppeteer-core):
// register → one-form request → PayStar approves → bank approves (with review step) → customer signs → credit available.
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://localhost:3104';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.env.OUT || '/tmp/shots';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
// MOBILE=1 runs the same flow on a phone-sized touch viewport.
await page.setViewport(process.env.MOBILE ? { width: 390, height: 844, isMobile: true, hasTouch: true } : { width: 1366, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const tag = Date.now().toString(36).slice(-5);
const NAME = `سمانه تست${tag}`;
const step = (m) => console.log('✓', m);

async function loginAs(name) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
  const [btn] = await page.$$(`xpath/.//button[contains(@class,'ps-role__user')][.//strong[contains(text(),'${name}')]]`);
  assert.ok(btn, 'role button ' + name);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), btn.click()]);
}
async function tapEl(el) {
  await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await new Promise((r) => setTimeout(r, 400));
  await el.click();
}
async function clickButton(text, scope = page) {
  const [b] = await scope.$$(`xpath/.//button[normalize-space(.)='${text}']`);
  assert.ok(b, 'button ' + text);
  // Like a person: bring the control to the middle of the screen, let smooth scrolling settle, then tap.
  await b.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await new Promise((r) => setTimeout(r, 400));
  await b.click();
}
const waitText = async (t, timeout = 15000) => {
  try { await page.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, t); }
  catch (e) {
    await page.screenshot({ path: `${OUT}/flow-failure.png` });
    const alerts = await page.$$eval('[role=alert], .ps-alert--error', (els) => els.map((x) => x.innerText.replace(/\s+/g, ' ')));
    throw new Error(`text not found: ${t}; visible alerts: ${JSON.stringify(alerts)}`);
  }
};

// 0. Super-admin creates a new bank user in the UI (PRD S1: invite user with role + scopes)
const BANKER = `نازنین فرهادی${tag}`;
await loginAs('مهدی کریمی');
await page.goto(BASE + '/admin/organizations', { waitUntil: 'networkidle0' });
const form = (await page.$$(`xpath/.//form[.//button[normalize-space(.)='ایجاد کاربر']]`))[0];
assert.ok(form, 'create user form');
await (await form.$('input[name="display_name"]')).type(BANKER);
await (await form.$('select[name="role"]')).select('bank');
const bankId = await form.$eval('select[name="organization_id"]', (sel) => [...sel.options].find((o) => o.text.includes('بانک'))?.value);
await (await form.$('select[name="organization_id"]')).select(bankId);
await tapEl(await form.$('input[name="scopes"][value="underwriting"]'));
await clickButton('ایجاد کاربر', form);
await clickButton('تأیید و ارسال', form);
await waitText('ثبت شد');
step('super-admin created bank user ' + BANKER);

// 1. Register a new customer through the referral page
await page.goto(BASE + '/r/DEMO-REFERRAL-TOKEN', { waitUntil: 'networkidle0' });
await page.type('#rg-first_name', 'سمانه');
await page.type('#rg-last_name', `تست${tag}`);
await page.waitForFunction(() => document.querySelector('#rg-national_id')?.value?.startsWith('DEMO-NID-'));
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), clickButton('ادامه')]);
assert.ok(page.url().endsWith('/account/application'));
step('registered and landed on /account/application');

// 2. One-form credit request
// Customer chooses 25 million toman in 6 installments.
const amountInput = await page.$('#qa-amount');
await amountInput.click({ clickCount: 3 });
await amountInput.type('25');
await clickButton('۶ قسط');
await page.type('#qa-otp', '123456');
for (const cb of await page.$$('form:has(#qa-otp) input[name="consents"]')) await tapEl(cb);
await clickButton('ثبت درخواست اعتبار');
await waitText('درخواست شما ثبت شد', 30000);
await page.screenshot({ path: `${OUT}/flow-1-submitted.png` });
step('customer submitted the credit request');

// 3. PayStar admin sees it and approves
await loginAs('سارا احمدی');
await waitText(NAME);
const card = (await page.$$(`xpath/.//div[contains(@class,'ps-card')][.//h3[contains(.,'${NAME}')]]`))[0];
assert.ok(card, 'application card on PayStar dashboard');
await clickButton('ثبت بررسی', card);
await waitText('ثبت شد');
step('PayStar approved (preliminary) — request sent to bank');

// 4. The NEW bank user sees it and approves (with review step)
await loginAs(BANKER);
await waitText(NAME);
const bcard = (await page.$$(`xpath/.//div[contains(@class,'ps-card')][.//h3[contains(.,'${NAME}')]]`))[0];
assert.ok(bcard, 'application card on bank dashboard');
await clickButton('ثبت تصمیم بانک', bcard);
await waitText('بررسی پیش از ارسال');
await page.screenshot({ path: `${OUT}/flow-2-bank-confirm.png` });
await clickButton('تأیید و ارسال', bcard);
await waitText('ثبت شد');
step('bank approved the requested 25m toman, 6 installments');

// 5. Customer signs the bank agreement → credit available
await loginAs(NAME);
await page.goto(BASE + '/account/credit', { waitUntil: 'networkidle0' });
await tapEl(await page.$('input[name="accept"]'));
await clickButton('امضای قرارداد بانک');
await clickButton('تأیید و ارسال');
await waitText('بدون محدودیت', 15000);
await page.screenshot({ path: `${OUT}/flow-3-credit.png`, fullPage: true });
const txt = await page.evaluate(() => document.body.innerText);
assert.ok(txt.includes('۲۵٬۰۰۰٬۰۰۰') || txt.includes('۲۵,۰۰۰,۰۰۰'), 'approved 25m toman limit shown');
assert.ok(txt.includes('۶ قسط'), 'six installments shown on the credit line');
step('customer signed; credit active and spendable');

await browser.close();
if (errors.length) { console.log('BROWSER ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('browser flow passed');
