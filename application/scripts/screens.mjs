// Real-browser screenshots of each workspace (uses the locally installed Chrome; no browser download).
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3104';
const OUT = process.env.OUT || '/tmp/shots';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

async function loginAs(name) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
  const [btn] = await page.$$(`xpath/.//button[contains(@class,'ps-role__user')][.//strong[text()='${name}']]`);
  if (!btn) throw new Error('role button not found: ' + name);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), btn.click()]);
}
async function shot(path, file, full = true) {
  if (path) await page.goto(BASE + path, { waitUntil: 'networkidle0' });
  await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: full });
}

await shot('/', '00-landing');
for (const [name, file, pages] of [
  ['مریم رضایی', 'customer', ['/account', '/account/purchases']],
  ['سارا احمدی', 'ops', ['/ops', '/ops/payments']],
  ['دکتر نرگس رحیمی', 'clinic', ['/business', '/business/orders']],
  ['محمد حسینی', 'bank', ['/bank', '/bank/loans/ea1af5c0-7d1f-502a-a7cb-ca59f0b5f601']],
  ['مهدی کریمی', 'admin', ['/admin', '/admin/operations']],
  ['نیلوفر اکبری', 'draft', ['/account/application']],
]) {
  await loginAs(name);
  for (const [i, p] of pages.entries()) await shot(p, `${file}-${i}`, i > 0 || file === 'draft');
}
await loginAs('محمد حسینی');
await page.setViewport({ width: 390, height: 844, isMobile: true });
await shot('/bank', 'mobile-bank', false);
await browser.close();
console.log(errors.length ? 'BROWSER ERRORS:\n' + [...new Set(errors)].join('\n') : 'no browser console errors');
