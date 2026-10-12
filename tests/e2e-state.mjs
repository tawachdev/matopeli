import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4321';
let failures = 0;

function check(name, cond) {
  console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name);
  if (!cond) failures++;
}

const browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

async function enterGame(page) {
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  await page.keyboard.press('#');
  await page.waitForTimeout(150);
}
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
page.on('requestfailed', (r) => problems.push('reqfail: ' + r.url()));
page.on('response', (r) => { if (r.status() >= 400) problems.push(r.status() + ' ' + r.url()); });

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await enterGame(page);
await page.waitForFunction(() => typeof window.__matopeli === 'object', null, { timeout: 15000 });
check('debug seam present (dev only)', true);

const api = (expr) => page.evaluate(`window.__matopeli.${expr}`);
const hidden = () => page.$eval('#banner', (el) => el.classList.contains('hidden'));
check('start screen shows', (await api('banner()')) === 'Snake II');

await page.click('#navi');
await page.waitForTimeout(300);
check('start enters level 1 running', (await api('state()')) === 1 && (await api('level()')) === 1);
check('audio unlocks to running after gesture', (await api('audio()')) === 'running');

await page.keyboard.press(' ');
await page.waitForTimeout(100);
check('pause freezes running game', (await api('state()')) === 2);
const pausedHead = await api('head()');
await page.waitForTimeout(300);
check('paused head does not move', JSON.stringify(await api('head()')) === JSON.stringify(pausedHead));
await page.keyboard.press('Enter');
check('resume runs again', await leftPause());
check('resumed snake moves', JSON.stringify(await api('head()')) !== JSON.stringify(pausedHead));

const OPP = { ArrowUp: 'ArrowDown', ArrowDown: 'ArrowUp', ArrowLeft: 'ArrowRight', ArrowRight: 'ArrowLeft' };
const DIRS = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
async function steerTowardFood() {
  const s = await page.evaluate(() => ({
    h: window.__matopeli.head(), f: window.__matopeli.food(), d: window.__matopeli.dir(),
  }));
  const dx = Math.sign(s.f[0] - s.h[0]);
  const dy = Math.sign(s.f[1] - s.h[1]);
  const cur = s.d[0] === 1 ? 'ArrowRight' : s.d[0] === -1 ? 'ArrowLeft' : s.d[1] === 1 ? 'ArrowDown' : 'ArrowUp';
  const opts = [];
  if (dx !== 0) opts.push(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
  if (dy !== 0) opts.push(dy > 0 ? 'ArrowDown' : 'ArrowUp');
  opts.push(...DIRS);
  for (const k of opts) {
    if (OPP[k] !== cur) {
      await page.keyboard.press(k);
      return;
    }
  }
}

async function leftPause() {
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(200);
    const st = await api('state()');
    if (st === 1) return true;
    if (st === 3 && (await api('banner()')) === 'Game over') return true;
  }
  return false;
}

async function ensureRunning() {
  for (let i = 0; i < 10; i++) {
    if ((await api('state()')) === 1) return true;
    if ((await api('banner()')) === 'Level 2') return true;
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
  }
  return false;
}

async function eatUpTo(targetProgress) {
  for (let i = 0; i < 400; i++) {
    if (!(await ensureRunning())) return false;
    if ((await api('level()')) === 2) return true;
    if ((await api('progress()')) >= targetProgress) return true;
    await steerTowardFood();
    await page.waitForTimeout(165);
  }
  return false;
}

check('eats first food (score 10, length 4)', await eatUpTo(1));
check('first eat exact', (await api('score()')) === 10 && (await api('length()')) === 4);

await page.keyboard.press(' ');
await page.waitForTimeout(100);
const frozen = await api('head()');
const frozenScore = await api('score()');
await page.waitForTimeout(400);
check('pause preserves head and score', (await api('state()')) === 2
  && JSON.stringify(await api('head()')) === JSON.stringify(frozen)
  && (await api('score()')) === frozenScore);
await page.keyboard.press('Enter');
check('resume never loses score and keeps moving', await leftPause()
  && (await api('score()')) >= frozenScore
  && JSON.stringify(await api('head()')) !== JSON.stringify(frozen));

await ensureRunning();
const tapScore = await api('score()');
await page.keyboard.press(' ');
await page.waitForTimeout(300);
await page.locator('#bannerTitle').click();
await page.waitForTimeout(400);
check('tap on pause resumes instead of restarting', (await api('banner()')) === 'hidden'
  && (await api('state()')) === 1
  && (await api('score()')) >= tapScore);

check('four more eats reach level 2', await eatUpTo(5));
await page.waitForFunction(() => window.__matopeli.banner() === 'Level 2', null, { timeout: 8000 });
check('level banner shows', true);
const keptScore = await api('score()');
await page.waitForTimeout(2500);
const autoBanner = await api('banner()');
const autoState = await api('state()');
check('next level starts automatically', (autoBanner === 'hidden' && autoState === 1) || autoBanner === 'Game over');
check('auto continue keeps level and score', (await api('level()')) === 2 && (await api('score()')) >= keptScore);

await ensureRunning();
let swiped = false;
for (let attempt = 0; attempt < 3 && !swiped; attempt++) {
  await ensureRunning();
  const dirBeforeSwipe = await api('dir()');
  const swipeUp = dirBeforeSwipe[1] === 0;
  await page.evaluate((up) => {
    const c = document.getElementById('lcd');
    const r = c.getBoundingClientRect();
    const t = (x, y) => new Touch({ identifier: 1, target: c, clientX: x, clientY: y });
    const x0 = r.x + 60, y0 = r.y + 60;
    c.dispatchEvent(new TouchEvent('touchstart', { touches: [t(x0, y0)], bubbles: true }));
    c.dispatchEvent(new TouchEvent('touchmove', { touches: [up ? t(x0, y0 - 120) : t(x0 + 120, y0)], bubbles: true }));
  }, swipeUp);
  await page.waitForTimeout(400);
  swiped = JSON.stringify(await api('dir()')) === JSON.stringify(swipeUp ? [0, -1] : [1, 0]);
}
check('touch swipe steers', swiped);

await ensureRunning();
await ensureRunning();
await page.keyboard.press('ArrowUp');
await page.click('#keypad button[data-k="4"]');
await page.waitForTimeout(600);
check('keyboard plus keypad queue without conflict', (await api('state()')) === 1);

await ensureRunning();
await page.click('#navi');
await page.waitForTimeout(100);
check('Navi pauses mid-game, no duplicate start', (await api('state()')) === 2);
const pausedScore = await api('score()');
await page.waitForTimeout(300);
check('button pause keeps score', (await api('score()')) === pausedScore);
await page.keyboard.press('Enter');
check('enter resumes after button pause', await leftPause());

check('console clean', problems.length === 0);
for (const p of problems) console.log('  ! ' + p);

await browser.close();
process.exit(failures ? 1 : 0);
