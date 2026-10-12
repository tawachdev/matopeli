import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4321';
let failures = 0;

function check(name, cond) {
  console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name);
  if (!cond) failures++;
}

const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome', headless: true });

async function bootToIdle(page) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const bootVisible = await page.$eval('#bootScreen', (el) => !el.classList.contains('hidden')).catch(() => false);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  return bootVisible;
}

const osText = (page) => page.$eval('#osScreen', (el) => el.textContent || '');

const ctxA = await browser.newContext({ viewport: { width: 420, height: 900 } });
const pageA = await ctxA.newPage();
const problems = [];
pageA.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });

check('boot screen shows then Enter skips it', await bootToIdle(pageA));
check('idle screen shows clock', /\d{2}:\d{2}/.test(await osText(pageA)));

await pageA.keyboard.press('#');
await pageA.waitForTimeout(150);
check('hash hides OS to game banner', await pageA.$eval('#banner', (el) => !el.classList.contains('hidden')));

await pageA.keyboard.press('#');
await pageA.waitForTimeout(150);
const menuText = await osText(pageA);
check('hash again opens main menu', menuText.includes('Messages') && menuText.includes('Games'));

await pageA.keyboard.press('ArrowDown');
await pageA.keyboard.press('Enter');
await pageA.waitForTimeout(250);
check('Games launches snake and hides OS', await pageA.$eval('#banner', (el) => el.classList.contains('hidden'))
  && (await pageA.$eval('#osRoot', (el) => el.classList.contains('hidden'))));

await pageA.keyboard.press('#');
await pageA.waitForTimeout(150);
await pageA.keyboard.press('ArrowDown');
await pageA.keyboard.press('ArrowDown');
await pageA.keyboard.press('Enter');
await pageA.waitForTimeout(150);
check('Contacts app opens', (await osText(pageA)).includes('Contacts'));

await pageA.keyboard.press('Escape');
await pageA.waitForTimeout(120);
await pageA.keyboard.press('Escape');
await pageA.waitForTimeout(120);
await pageA.keyboard.press('ArrowDown');
await pageA.keyboard.press('ArrowDown');
await pageA.keyboard.press('ArrowDown');
await pageA.keyboard.press('Enter');
await pageA.waitForTimeout(120);
check('Extras submenu opens', (await osText(pageA)).includes('Calculator'));

await pageA.keyboard.press('Enter');
await pageA.waitForTimeout(150);
check('Calculator opens', (await osText(pageA)).includes('Calculator'));
for (const key of ['1', '2', '#', '3', '4']) await pageA.keyboard.press(key);
await pageA.keyboard.press('Enter');
await pageA.waitForTimeout(150);
check('calculator evaluates 12*34=408', (await osText(pageA)).includes('408'));

await pageA.keyboard.press('Escape');
await pageA.waitForTimeout(120);
await pageA.keyboard.press('ArrowDown');
await pageA.keyboard.press('ArrowDown');
await pageA.keyboard.press('ArrowDown');
await pageA.keyboard.press('Enter');
await pageA.waitForTimeout(120);
await pageA.keyboard.press('ArrowDown');
await pageA.keyboard.press('Enter');
await pageA.waitForTimeout(150);
check('Composer opens', (await osText(pageA)).includes('Composer'));
await pageA.keyboard.press('1');
await pageA.keyboard.press('2');
await pageA.waitForTimeout(120);
check('composer adds notes', /c/.test(await osText(pageA)) && /d/.test(await osText(pageA)));

await pageA.keyboard.press('Backspace');
await pageA.waitForTimeout(120);
await pageA.keyboard.press('Escape');
await pageA.waitForTimeout(120);
await pageA.keyboard.press('Enter');
await pageA.waitForTimeout(600);
const aMsgText = await osText(pageA);
check('Messages shows own SIM number', /\+\d{8,}/.test(aMsgText));

const ctxB = await browser.newContext({ viewport: { width: 420, height: 900 } });
const pageB = await ctxB.newPage();
await bootToIdle(pageB);
await pageB.keyboard.press('Enter');
await pageA.waitForTimeout(120);
await pageB.keyboard.press('Enter');
await pageB.waitForTimeout(600);
const bText = await osText(pageB);
check('second phone registers own number', /\+\d{8,}/.test(bText));
const bNumber = (bText.match(/\+\d{8,}/) || [''])[0];
check('B number extracted', bNumber.startsWith('+'));
await pageB.keyboard.press('Escape');
await pageA.waitForTimeout(120);
await pageB.keyboard.press('Escape');
await pageA.waitForTimeout(120);

const digits = bNumber.replace(/\D/g, '');
await pageA.keyboard.press('*');
await pageA.waitForTimeout(120);
await pageA.keyboard.press('*');
for (const d of '212') await pageA.keyboard.press(d);
for (const d of digits.slice(3)) await pageA.keyboard.press(d);
await pageA.keyboard.press('ArrowRight');
await pageA.keyboard.press('9');
await pageA.keyboard.press('8');
await pageA.keyboard.press('ArrowRight');
await pageA.keyboard.press('Enter');
await pageA.waitForTimeout(1500);
const aThread = await osText(pageA);
check('A thread shows sent message', aThread.includes('98'));

await pageB.waitForFunction(() => /MESSAGES\s*1/.test(document.getElementById('osScreen')?.textContent || ''), null, { timeout: 8000 });
check('B idle shows unread badge', true);

await pageB.keyboard.press('Enter');
await pageA.waitForTimeout(200);
await pageB.keyboard.press('Enter');
await pageB.waitForFunction(() => (document.getElementById('osScreen')?.textContent || '').includes('98'), null, { timeout: 8000 });
check('B receives message in real time', true);
check('console clean', problems.length === 0);
for (const p of problems) console.log('  ! ' + p);

await browser.close();
process.exit(failures ? 1 : 0);
