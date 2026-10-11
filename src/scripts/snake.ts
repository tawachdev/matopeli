

interface SnakeExports {
  snake_create(seed: bigint): number;
  snake_destroy(p: number): void;
  snake_reset(p: number, level: number): void;
  snake_set_dir(p: number, d: number): void;
  snake_start(p: number): void;
  snake_pause(p: number): void;
  snake_tick(p: number): number;
  snake_state(p: number): number;
  snake_score(p: number): number;
  snake_level(p: number): number;
  snake_progress(p: number): number;
  snake_cause(p: number): number;
  snake_len(p: number): number;
  snake_cell_x(p: number, i: number): number;
  snake_cell_y(p: number, i: number): number;
  snake_food_x(p: number): number;
  snake_food_y(p: number): number;
  snake_bonus_x(p: number): number;
  snake_bonus_y(p: number): number;
  snake_bonus_ttl(p: number): number;
  snake_wall_count(p: number): number;
  snake_wall_x(p: number, i: number): number;
  snake_wall_y(p: number, i: number): number;
  snake_speed_ms(p: number): number;
  snake_cols(): number;
  snake_rows(): number;
  snake_goal(): number;
  snake_max_level(): number;
}

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error('missing #' + id);
  return el;
};
const canvas = $('lcd') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const banner = $('banner'), bannerTitle = $('bannerTitle'), bannerSub = $('bannerSub');

const bytes = await (await fetch(`${import.meta.env.BASE_URL}engine.wasm`)).arrayBuffer();
const W = (await WebAssembly.instantiate(bytes, {})).instance.exports as unknown as SnakeExports;

const GOAL = W.snake_goal(), MAXL = W.snake_max_level();
const CELL = 10; // 28*10 x 16*10 = 280x160 canvas pixels
const INK = '#232a12', PAPER = '#9aa763', DIM = '#6b743f';

const ptr = W.snake_create(BigInt(Date.now()));
let best = +(localStorage.getItem('snake2_best') || 0);
let startLevel = 1, acc = 0, last = performance.now();
let muted = false, startScreen = true;
let popup: { text: string; until: number } | null = null;
($('best') as HTMLElement).textContent = String(best);

let AC: AudioContext | null = null;
function beep(freq: number, ms: number, type: OscillatorType = 'square', vol = 0.04) {
  if (muted) return;
  AC = AC || new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + ms / 1000);
  o.connect(g); g.connect(AC.destination);
  o.start(); o.stop(AC.currentTime + ms / 1000);
}
const sfx = {
  eat:   () => beep(1250, 55),
  bonus: () => { beep(1174, 70); setTimeout(() => beep(1568, 90), 70); },
  die:   () => { beep(392, 120, 'sawtooth'); setTimeout(() => beep(185, 240, 'sawtooth'), 110); },
  level: () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 90), i * 90)); },
  turn:  () => beep(440, 30, 'square', 0.015),
  click: () => beep(2100, 18, 'square', 0.02),
};

const lvBox = $('levels');
for (let l = 1; l <= MAXL; l++) {
  const b = document.createElement('button');
  b.textContent = String(l);
  b.className = 'level-btn' + (l === 1 ? ' picked' : '');
  b.onclick = () => {
    startLevel = l;
    [...lvBox.children].forEach((x) => x.classList.remove('picked'));
    b.classList.add('picked');
  };
  lvBox.appendChild(b);
}

function showBanner(title: string, sub: string, showLevels: boolean) {
  bannerTitle.textContent = title; bannerSub.textContent = sub;
  (lvBox as HTMLElement).style.display = showLevels ? 'flex' : 'none';
  banner.classList.remove('hidden');
}
function hideBanner() { banner.classList.add('hidden'); }

function startGame() {
  W.snake_reset(ptr, startLevel);
  W.snake_start(ptr);
  acc = 0; last = performance.now();
  startScreen = false;
  hideBanner();
}
function togglePause() {
  const st = W.snake_state(ptr);
  if (st === 1 || st === 2) {
    W.snake_pause(ptr);
    if (W.snake_state(ptr) === 2) showBanner('Paused', 'Press Space or Start to resume', false);
    else hideBanner();
  }
}
function onDeath() {
  const score = W.snake_score(ptr);
  if (score > best) { best = score; localStorage.setItem('snake2_best', String(best)); }
  ($('best') as HTMLElement).textContent = String(best);
  sfx.die();
  try { if (navigator.vibrate) navigator.vibrate(90); } catch {  }
  const cause = W.snake_cause(ptr) === 1 ? 'Hit the wall' : 'Bit yourself';
  showBanner('Game over', `${cause} · Score ${score} · Best ${best} — Enter to retry`, false);
}
function onLevelUp() {
  sfx.level();
  showBanner(`Level ${W.snake_level(ptr)}`, 'Speed up! Press Enter or tap Start', false);
}

function frame(now: number) {
  const dt = Math.min(now - last, 250); last = now;
  if (W.snake_state(ptr) === 1) {
    acc += dt;
    const step = W.snake_speed_ms(ptr);
    while (acc >= step && W.snake_state(ptr) === 1) {
      acc -= step;
      const before = W.snake_score(ptr);
      const ev = W.snake_tick(ptr);
      if (ev === 1) sfx.eat();
      else if (ev === 2) { sfx.bonus(); popup = { text: '+' + (W.snake_score(ptr) - before), until: now + 900 }; }
      else if (ev === 3) { onDeath(); break; }
      else if (ev === 4) { onLevelUp(); break; }
    }
  }
  render(now);
  requestAnimationFrame(frame);
}

function px(x: number, y: number, color: string, big = false) {
  ctx.fillStyle = color;
  const p = big ? 0 : 1;
  ctx.fillRect(x * CELL + p, y * CELL + p, CELL - p * 2, CELL - p * 2);
}
function render(now: number) {
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const nw = W.snake_wall_count(ptr);
  for (let i = 0; i < nw; i++) {
    const x = W.snake_wall_x(ptr, i), y = W.snake_wall_y(ptr, i);
    px(x, y, INK, true);
    ctx.fillStyle = PAPER;
    ctx.fillRect(x * CELL, y * CELL, CELL, 1);
    ctx.fillRect(x * CELL, y * CELL, 1, CELL);
  }
  if (Math.floor(now / 250) % 2 === 0) px(W.snake_food_x(ptr), W.snake_food_y(ptr), INK);
  const bx = W.snake_bonus_x(ptr);
  if (bx >= 0) {
    const by = W.snake_bonus_y(ptr), ttl = W.snake_bonus_ttl(ptr);
    if (ttl > 10 || Math.floor(now / 120) % 2 === 0) {
      const cx = bx * CELL, cy = by * CELL;
      ctx.fillStyle = INK;
      ctx.fillRect(cx + 1, cy + 1, CELL - 2, CELL - 2);
      ctx.fillStyle = PAPER;
      ctx.fillRect(cx + 3, cy + 3, CELL - 6, CELL - 6);
      ctx.fillStyle = INK;
      ctx.fillRect(cx + 4, cy + 4, CELL - 8, CELL - 8);
    }
  }
  const n = W.snake_len(ptr);
  for (let i = n - 1; i >= 1; i--) px(W.snake_cell_x(ptr, i), W.snake_cell_y(ptr, i), i % 2 ? DIM : INK);
  if (n > 0) {
    const hx = W.snake_cell_x(ptr, 0), hy = W.snake_cell_y(ptr, 0);
    px(hx, hy, INK, true);
    ctx.fillStyle = PAPER;
    ctx.fillRect(hx * CELL + 2, hy * CELL + 2, 2, 2);
    ctx.fillRect(hx * CELL + 6, hy * CELL + 2, 2, 2);
  }
  ($('score') as HTMLElement).textContent = String(W.snake_score(ptr));
  ($('level') as HTMLElement).textContent = `Level ${W.snake_level(ptr)}/${MAXL}`;
  if (popup) {
    if (now > popup.until) popup = null;
    else {
      ctx.fillStyle = INK;
      ctx.font = 'bold 13px "Courier New",monospace';
      ctx.textAlign = 'center';
      ctx.fillText('BONUS ' + popup.text, canvas.width / 2, 22);
      ctx.textAlign = 'left';
    }
  }
  const dots = $('dots'), prog = W.snake_progress(ptr);
  if (dots.children.length !== GOAL) {
    dots.innerHTML = '';
    for (let i = 0; i < GOAL; i++) dots.appendChild(document.createElement('i'));
  }
  [...dots.children].forEach((d, i) => d.classList.toggle('on', i < prog));
}

function confirmKey() {
  sfx.click();
  if (!banner.classList.contains('hidden')) startGame();
  else togglePause();
}
function clearKey() {
  sfx.click();
  const st = W.snake_state(ptr);
  if (st === 1 || st === 2) togglePause();
}
function digitKey(d: number) {
  sfx.click();
  if (startScreen && d >= 1 && d <= 9) {
    startLevel = d;
    [...lvBox.children].forEach((x, i) => (x as HTMLElement).classList.toggle('picked', i === d - 1));
  }
}
const STEER: Record<number, number> = { 2: 0, 4: 3, 6: 1, 8: 2 };
document.querySelectorAll<HTMLButtonElement>('#keypad button').forEach((b) => {
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const k = b.dataset.k || '';
    if (k >= '0' && k <= '9') {
      const d = +k;
      if (startScreen && d >= 1 && d <= 9) digitKey(d);
      else if (d in STEER && W.snake_state(ptr) === 1) { W.snake_set_dir(ptr, STEER[d]); sfx.turn(); }
      else sfx.click();
    } else sfx.click();
  });
});
($('softL') as HTMLButtonElement).onclick = confirmKey;
($('navi') as HTMLButtonElement).onclick = confirmKey;
($('keyC') as HTMLButtonElement).onclick = clearKey;

const KEYMAP: Record<string, number> = { ArrowUp: 0, w: 0, W: 0, ArrowRight: 1, d: 1, D: 1, ArrowDown: 2, s: 2, S: 2, ArrowLeft: 3, a: 3, A: 3 };
window.addEventListener('keydown', (e) => {
  if (e.key in KEYMAP) { e.preventDefault(); W.snake_set_dir(ptr, KEYMAP[e.key]); sfx.turn(); }
  else if (e.key >= '1' && e.key <= '9') {
    const d = +e.key;
    if (startScreen) digitKey(d);
    else if (d in STEER && W.snake_state(ptr) === 1) { W.snake_set_dir(ptr, STEER[d]); sfx.turn(); }
  }
  else if (e.key === ' ' || e.key === 'Escape') { e.preventDefault(); clearKey(); }
  else if (e.key === 'Enter') confirmKey();
});
let touch: [number, number] | null = null;
canvas.addEventListener('touchstart', (e) => { touch = [e.touches[0].clientX, e.touches[0].clientY]; }, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  if (!touch) return;
  const dx = e.touches[0].clientX - touch[0], dy = e.touches[0].clientY - touch[1];
  if (Math.abs(dx) < 18 && Math.abs(dy) < 18) return;
  W.snake_set_dir(ptr, Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
  touch = [e.touches[0].clientX, e.touches[0].clientY];
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('click', () => { if (!banner.classList.contains('hidden')) startGame(); });
($('btnSound') as HTMLButtonElement).onclick = () => {
  muted = !muted;
  ($('btnSound') as HTMLButtonElement).textContent = muted ? 'Sound off' : 'Sound on';
  if (!muted) sfx.click();
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden && W.snake_state(ptr) === 1) togglePause();
});
window.addEventListener('pagehide', () => W.snake_destroy(ptr));

showBanner('Snake II', 'Key 1-9 picks a level, Start begins', true);
requestAnimationFrame(frame);
