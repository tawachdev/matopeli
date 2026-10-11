import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8901';
let failures = 0;

function check(name, cond) {
  console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name);
  if (!cond) failures++;
}

const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
page.on('requestfailed', (r) => problems.push('reqfail: ' + r.url()));

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });
await page.waitForFunction(
  async () => {
    const hit = await caches.match(new URL('engine.wasm', location.href).toString());
    return hit !== undefined;
  },
  null,
  { timeout: 20000 }
);
check('service worker controls page', true);
check('engine.wasm precached', true);

await ctx.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
check('page renders offline', await page.$eval('#banner', (el) => el.classList.contains('hidden') === false));
await page.click('#softL');
await page.waitForTimeout(500);
check('game starts offline', await page.$eval('#banner', (el) => el.classList.contains('hidden')));
check('level line reads offline', (await page.textContent('#level')) === 'Level 1');

check('console clean', problems.length === 0);
for (const p of problems) console.log('  ! ' + p);

await browser.close();
process.exit(failures ? 1 : 0);
