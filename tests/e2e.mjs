import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8901';
let failures = 0;

function check(name, cond) {
  console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name);
  if (!cond) failures++;
}

const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
page.on('requestfailed', (r) => problems.push('reqfail: ' + r.url()));
page.on('response', (r) => { if (r.status() >= 400) problems.push(r.status() + ' ' + r.url()); });

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

check('start banner visible', await page.$eval('#banner', (el) => el.classList.contains('hidden') === false));
check('9 level buttons', (await page.$$('#levels button')).length === 9);

await page.click('#softL');
await page.waitForTimeout(200);
check('start hides banner', await page.$eval('#banner', (el) => el.classList.contains('hidden')));
check('fresh game starts level 1', (await page.textContent('#level')) === 'Level 1');

await page.keyboard.press(' ');
await page.waitForTimeout(300);
check('pause shows banner', (await page.textContent('#bannerTitle')) === 'Paused');
const scoreBefore = await page.textContent('#score');
const levelBefore = await page.textContent('#level');
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
check('resume hides banner', await page.$eval('#banner', (el) => el.classList.contains('hidden')));
check('resume keeps score', (await page.textContent('#score')) === scoreBefore);
check('resume keeps level', (await page.textContent('#level')) === levelBefore);

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.click('#levels button:nth-child(6)');
await page.click('#softL');
await page.waitForFunction(
  () => document.getElementById('bannerTitle').textContent === 'Game over',
  { timeout: 30000 }
);
check('border wall kills on level 6', true);
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
check('restart hides banner', await page.$eval('#banner', (el) => el.classList.contains('hidden')));
check('restart resets score to 0', (await page.textContent('#score')) === '0');
check('restart keeps picked level 6', (await page.textContent('#level')) === 'Level 6');

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.click('#levels button:last-child');
await page.click('#softL');
await page.waitForTimeout(300);
check('picker starts level 9', (await page.textContent('#level')) === 'Level 9');

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.fill('#levelInput', '20');
await page.click('#softL');
await page.waitForTimeout(300);
check('typed level input starts level 20', (await page.textContent('#level')) === 'Level 20');

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.click('#btnSettings');
await page.waitForTimeout(200);
check('settings panel opens', await page.$eval('#settings', (el) => !el.classList.contains('hidden')));
check('settings has 4 toggles', (await page.$$('.setting-row')).length === 4);
await page.click('.setting-row[data-setting="sound"]');
await page.waitForTimeout(120);
check('sound toggle flips to Off', (await page.$eval('#setSound', (el) => el.textContent)) === 'Off');
check('sound pref persisted', await page.evaluate(() => localStorage.getItem('snake2_sound') === '0'));
await page.click('.setting-row[data-setting="theme"]');
await page.waitForTimeout(120);
check('theme toggle flips to Light', (await page.$eval('#setTheme', (el) => el.textContent)) === 'Light');
check('theme pref persisted', await page.evaluate(() => localStorage.getItem('snake2_theme') === 'light'));
check('light mode applies to body', await page.$eval('body', (el) => el.classList.contains('light')));
await page.click('#settingsClose');
await page.waitForTimeout(120);
check('settings closes', await page.$eval('#settings', (el) => el.classList.contains('hidden')));

await page.evaluate(() => localStorage.setItem('snake2_scores', JSON.stringify([500, 300, 120])));
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const hallText = await page.$eval('#hall', (el) => el.textContent || '');
check('high score table renders top scores', hallText.includes('500') && hallText.includes('300') && hallText.includes('120'));

check('console clean', problems.length === 0);
for (const p of problems) console.log('  ! ' + p);

await browser.close();
process.exit(failures ? 1 : 0);
