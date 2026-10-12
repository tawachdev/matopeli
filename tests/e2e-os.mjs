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
const press = async (page, key) => {
  await page.keyboard.press(key);
  await page.waitForTimeout(90);
};

const ctxA = await browser.newContext({ viewport: { width: 420, height: 900 } });
const pageA = await ctxA.newPage();
const problems = [];
pageA.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });

check('boot screen shows then Enter skips it', await bootToIdle(pageA));
check('idle screen shows clock', /\d{2}:\d{2}/.test(await osText(pageA)));

await press(pageA, '#');
check('hash hides OS to game banner', await pageA.$eval('#banner', (el) => !el.classList.contains('hidden')));

await press(pageA, '#');
const menuText = await osText(pageA);
check('main menu shows classic Nokia entries', ['Messages', 'Call register', 'Tones', 'Settings', 'Games', 'Calculator', 'Reminders', 'Names'].every((label) => menuText.includes(label)));

for (let i = 0; i < 4; i++) await press(pageA, 'ArrowDown');
await press(pageA, 'Enter');
const gamesText = await osText(pageA);
check('Games submenu lists Snake II and Pairs II', gamesText.includes('Snake II') && gamesText.includes('Pairs II'));
await press(pageA, 'Enter');
await pageA.waitForTimeout(250);
check('Snake II launches and hides OS', await pageA.$eval('#banner', (el) => el.classList.contains('hidden'))
  && (await pageA.$eval('#osRoot', (el) => el.classList.contains('hidden'))));

await press(pageA, '#');
for (let i = 0; i < 4; i++) await press(pageA, 'ArrowDown');
await press(pageA, 'Enter');
await press(pageA, 'ArrowDown');
await press(pageA, 'Enter');
await pageA.waitForTimeout(200);
check('Pairs II opens with 16 cells', (await pageA.$$('.os-cell')).length === 16);
await press(pageA, 'Enter');
await press(pageA, 'ArrowRight');
await press(pageA, 'Enter');
await pageA.waitForTimeout(200);
check('Pairs II flips cards', (await pageA.$$('.os-cell.flip')).length >= 1);
await pageA.waitForTimeout(900);
await press(pageA, 'Escape');

for (let i = 0; i < 7; i++) await press(pageA, 'ArrowDown');
await press(pageA, 'Enter');
await pageA.waitForTimeout(150);
const contactsText = await osText(pageA);
check('Names opens contacts app', contactsText.includes('Contacts') || contactsText.includes('add'));
await press(pageA, 'Escape');
await press(pageA, 'Escape');

await press(pageA, 'ArrowDown');
await press(pageA, 'Enter');
check('Call register submenu opens', (await osText(pageA)).includes('Dialled numbers'));
await press(pageA, 'Escape');

await press(pageA, 'ArrowDown');
await press(pageA, 'ArrowDown');
await press(pageA, 'Enter');
check('Tones menu opens', (await osText(pageA)).includes('Ringing tone'));
for (let i = 0; i < 4; i++) await press(pageA, 'ArrowDown');
await press(pageA, 'Enter');
await pageA.waitForTimeout(150);
check('Composer opens from Tones', (await osText(pageA)).includes('Composer'));
await press(pageA, '1');
await press(pageA, '2');
check('composer adds notes', /c/.test(await osText(pageA)) && /d/.test(await osText(pageA)));
await press(pageA, 'Backspace');
await press(pageA, 'Escape');

for (let i = 0; i < 5; i++) await press(pageA, 'ArrowDown');
await press(pageA, 'Enter');
await pageA.waitForTimeout(150);
check('Calculator opens', (await osText(pageA)).includes('Calculator'));
for (const key of ['1', '2', '#', '3', '4']) await press(pageA, key);
await press(pageA, 'Enter');
check('calculator evaluates 12*34=408', (await osText(pageA)).includes('408'));
await press(pageA, 'Escape');

await press(pageA, 'Enter');
await press(pageA, 'ArrowDown');
await press(pageA, 'Enter');
await pageA.waitForTimeout(500);
check('Messages submenu then Inbox shows own SIM number', /\+\d{8,}/.test(await osText(pageA)));

const ctxB = await browser.newContext({ viewport: { width: 420, height: 900 } });
const pageB = await ctxB.newPage();
await bootToIdle(pageB);
await press(pageB, 'Enter');
await press(pageB, 'Enter');
await press(pageB, 'ArrowDown');
await press(pageB, 'Enter');
await pageB.waitForTimeout(700);
const bText = await osText(pageB);
check('second phone registers own number', /\+\d{8,}/.test(bText));
const bNumber = (bText.match(/\+\d{8,}/) || [''])[0];
check('B number extracted', bNumber.startsWith('+'));
await press(pageB, 'Escape');
await press(pageB, 'Escape');
await press(pageB, 'Escape');

const digits = bNumber.replace(/\D/g, '');
await press(pageA, '*');
await press(pageA, '*');
for (const d of '212') await press(pageA, d);
for (const d of digits.slice(3)) await press(pageA, d);
await press(pageA, 'ArrowRight');
await press(pageA, '9');
await press(pageA, '8');
await press(pageA, 'ArrowRight');
await press(pageA, 'Enter');
await pageA.waitForTimeout(1500);
check('A thread shows sent message', (await osText(pageA)).includes('98'));

await pageB.waitForFunction(() => /MESSAGES\s*1/.test(document.getElementById('osScreen')?.textContent || ''), null, { timeout: 8000 });
check('B idle shows unread badge', true);

await press(pageB, 'Enter');
await press(pageB, 'Enter');
await press(pageB, 'ArrowDown');
await press(pageB, 'Enter');
await pageB.waitForFunction(() => (document.getElementById('osScreen')?.textContent || '').includes('98'), null, { timeout: 8000 });
check('B receives message in real time', true);
check('console clean', problems.length === 0);
for (const p of problems) console.log('  ! ' + p);

await browser.close();
process.exit(failures ? 1 : 0);
