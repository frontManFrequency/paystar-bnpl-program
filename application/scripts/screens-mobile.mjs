// Mobile screenshots (390×844, touch) of every workspace using the local Chrome.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3104';
const OUT = process.env.OUT || '/tmp/shots/mobile';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ONLY = process.argv[2];
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

async function loginAs(name) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
  const [btn] = await page.$$(`xpath/.//button[contains(@class,'ps-role__user')][.//strong[text()='${name}']]`);
  if (!btn) throw new Error('role button not found: ' + name);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), btn.click()]);
}
async function shot(path, file, full = false) {
  await page.goto(BASE + path, { waitUntil: 'networkidle0' });
  // A page wider than the device makes mobile Chrome widen the layout viewport (zoom out), so compare against the device width.
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, window.innerWidth) - 390);
  if (overflow > 0) errors.push(`${path}: content is ${overflow}px wider than the phone`);
  await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: full });
}

const PLAN = [
  [null, 'landing', [['/', 'landing', true]]],
  ['مریم رضایی', 'customer', [['/account', 'c-home', true], ['/account/purchases', 'c-purchases', true], ['/account/credit', 'c-credit'], ['/account/purchases/ea1af5c0-7d1f-502a-a7cb-ca59f0b5f601', 'c-statement', true]]],
  ['نیلوفر اکبری', 'draft', [['/account/application', 'd-apply', true]]],
  ['سارا احمدی', 'ops', [['/ops', 'o-home', true], ['/ops/payments', 'o-payments', true]]],
  ['محمد حسینی', 'bank', [['/bank', 'b-home', true], ['/bank/loans', 'b-loans', true]]],
  ['دکتر نرگس رحیمی', 'clinic', [['/business/orders', 'k-orders', true]]],
  ['مهدی کریمی', 'admin', [['/admin', 'a-home', true], ['/admin/organizations', 'a-users', true], ['/admin/operations', 'a-ops', true], ['/admin/audit', 'a-audit', true], ['/admin/policies', 'a-policies', true]]],
];
// Every sidebar section of every role is checked for overflow (screenshots saved too).
const ALL = {
  customer: ['/account/application', '/account/credit', '/account/wallet', '/account/support', '/account/notifications'],
  ops: ['/ops/applications', '/ops/purchases', '/ops/settlements', '/ops/refunds', '/ops/collections', '/ops/support', '/ops/recon', '/ops/purchases/ea1af5c0-7d1f-502a-a7cb-ca59f0b5f601'],
  bank: ['/bank/applications', '/bank/checks', '/bank/disbursements', '/bank/amendments', '/bank/collections', '/bank/hardship', '/bank/invoices', '/bank/loans/ea1af5c0-7d1f-502a-a7cb-ca59f0b5f601'],
  clinic: ['/business', '/business/purchases', '/business/referrals', '/business/guarantee'],
  admin: ['/admin/applications'],
};
for (const row of PLAN) for (const p of ALL[row[1]] ?? []) row[2].push([p, (row[1] + p).replace(/[^a-z0-9]+/gi, '-').slice(0, 60), true]);
for (const [user, group, pages] of PLAN) {
  if (ONLY && group !== ONLY) continue;
  if (user) await loginAs(user);
  for (const [path, file, full] of pages) await shot(path, file, full);
  if (group === 'bank') {
    await page.goto(BASE + '/bank', { waitUntil: 'networkidle0' });
    const [more] = await page.$$('xpath/.//nav[contains(@class,"app-tabbar")]//button');
    await more.tap();
    await page.waitForSelector('.app-sheet');
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: OUT + '/b-sheet.png' });
  }
}
await browser.close();
console.log(errors.length ? 'ISSUES:\n' + [...new Set(errors)].join('\n') : 'no issues');
