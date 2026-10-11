

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
  snake_bump(p: number): number;
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

async function loadEngine(): Promise<SnakeExports | null> {
  try {
    const res = await fetch('engine.wasm');
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    return (await WebAssembly.instantiate(bytes, {})).instance.exports as unknown as SnakeExports;
  } catch {
    return null;
  }
}
function loadBest(): number {
  try {
    const raw = localStorage.getItem('snake2_best');
    const value = raw === null ? 0 : +raw;
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}
function saveBest(value: number) {
  try {
    localStorage.setItem('snake2_best', String(value));
  } catch {}
}

const SCORES_KEY = 'snake2_scores';
const TOP_N = 3;
function loadScores(): number[] {
  try {
    const raw = localStorage.getItem(SCORES_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0)
      .map((n) => Math.floor(n))
      .sort((a, b) => b - a)
      .slice(0, TOP_N);
  } catch {
    return [];
  }
}
function saveScores(scores: number[]) {
  try {
    localStorage.setItem(SCORES_KEY, JSON.stringify(scores.slice(0, TOP_N)));
  } catch {}
}
function recordScore(score: number): number {
  if (score <= 0) return 0;
  const scores = loadScores();
  scores.push(score);
  scores.sort((a, b) => b - a);
  const trimmed = scores.slice(0, TOP_N);
  saveScores(trimmed);
  const at = trimmed.indexOf(score);
  return at >= 0 ? at + 1 : 0;
}

function loadPref(key: string, dflt: string): string {
  try {
    const v = localStorage.getItem(key);
    return v === null ? dflt : v;
  } catch {
    return dflt;
  }
}
function savePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}
const PREF_SOUND = 'snake2_sound';
const PREF_VIBRATE = 'snake2_vibrate';
const PREF_SCAN = 'snake2_scan';
const PREF_THEME = 'snake2_theme';
const PREF_STYLE = 'snake2_style';

const maybeEngine = await loadEngine();
if (!maybeEngine) {
  bannerTitle.textContent = 'No engine';
  bannerSub.textContent = 'engine.wasm failed to load — check connection and reload';
  throw new Error('engine.wasm load failed');
}
const engine: SnakeExports = maybeEngine;

const GOAL = engine.snake_goal(), MAX_LEVEL = engine.snake_max_level();
const CELL_PX = canvas.width / engine.snake_cols();
const BOARD_Y = 30;
const INK = '#26300f', PAPER = '#b3c948';
const BONUS_CELLS = 2;
const MAX_FRAME_MS = 250;
const FOOD_BLINK_MS = 250;
const BONUS_BLINK_MS = 120;
const BONUS_WARN_TTL = 10;
const SWIPE_MIN_PX = 18;
const POPUP_MS = 900;
const VIBRATE_MS = 90;
const DEATH_PAUSE_MS = 900;
const LEVEL_FLASH_MS = 400;
const DEATH_BLINK_MS = 150;

let game = engine.snake_create(BigInt(Date.now()));
let destroyed = false;
let best = loadBest();
let startLevel = 1, acc = 0, last = performance.now();
let soundOn = loadPref(PREF_SOUND, '1') === '1';
let vibrateOn = loadPref(PREF_VIBRATE, '1') === '1';
const SOUND_STYLES = ['classic', 'soft', 'retro'] as const;
type SoundStyle = (typeof SOUND_STYLES)[number];
function loadStyle(): SoundStyle {
  const raw = loadPref(PREF_STYLE, 'classic');
  return (SOUND_STYLES as readonly string[]).includes(raw) ? (raw as SoundStyle) : 'classic';
}
let soundStyle = loadStyle();
let startScreen = true;
let rolling = false;
let popup: { text: string; until: number } | null = null;
let endBannerAt: number | null = null;
let endWon = false;
let levelBannerAt: number | null = null;
let autoContinueAt: number | null = null;
const AUTO_CONTINUE_MS = 1000;
let flashUntil = 0;
let shownScore = 0;
let lastEatAt = 0;
const scoreEl = $('score');
const levelEl = $('level');
const barEl = $('progressBar');
const levelInput = $('levelInput') as HTMLInputElement;
const hallEl = $('hall');
const settingsEl = $('settings');
const scanEl = document.querySelector('.scanlines') as HTMLElement | null;
let lastRank = 0;
$('best').textContent = String(best);

let audioCtx: AudioContext | null = null;
function beep(freq: number, ms: number, type: OscillatorType = 'square', vol = 0.04, style: SoundStyle = soundStyle) {
  if (!soundOn) return;
  let f = freq, t = type, v = vol;
  if (style === 'soft') { t = 'sine'; f = freq * 0.9; v = vol * 0.75; }
  else if (style === 'retro') { f = freq * 0.55; v = vol * 1.25; }
  audioCtx = audioCtx || new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
  osc.type = t; osc.frequency.value = f;
  gain.gain.setValueAtTime(v, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + ms / 1000);
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.start(); osc.stop(audioCtx.currentTime + ms / 1000);
}
const sfx = {
  eat:   () => beep(1250, 55),
  bonus: () => { beep(1174, 70); setTimeout(() => beep(1568, 90), 70); },
  die:   () => {
    [392, 330, 262, 175].forEach((freq, order) => setTimeout(() => beep(freq, 160, 'sawtooth', 0.05), order * 120));
  },
  level: () => {
    [523, 659, 784, 1046, 784, 1046, 1318].forEach((freq, order) => setTimeout(() => beep(freq, 85), order * 85));
  },
  win:   () => {
    [784, 988, 1174, 1568].forEach((freq, order) => setTimeout(() => beep(freq, 110), order * 100));
  },
  turn:  () => beep(440, 30, 'square', 0.015),
  click: () => beep(2100, 18, 'square', 0.02),
};

const levelPicker = $('levels');
for (let level = 1; level <= MAX_LEVEL; level++) {
  const levelButton = document.createElement('button');
  levelButton.textContent = String(level);
  levelButton.className = 'level-btn' + (level === 1 ? ' picked' : '');
  levelButton.onclick = () => {
    startLevel = level;
    levelInput.value = '';
    [...levelPicker.children].forEach((child) => child.classList.remove('picked'));
    levelButton.classList.add('picked');
  };
  levelPicker.appendChild(levelButton);
}
levelInput.addEventListener('input', () => {
  const parsed = parseInt(levelInput.value, 10);
  if (Number.isFinite(parsed) && parsed >= 1) {
    startLevel = Math.min(parsed, 99);
    [...levelPicker.children].forEach((child) => child.classList.remove('picked'));
  }
});
levelInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); startGame(); }
});

type BannerKind = 'start' | 'pause' | 'level' | 'over';
let bannerKind: BannerKind = 'start';

function renderHall() {
  const scores = loadScores();
  hallEl.innerHTML = '';
  if (scores.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No scores yet';
    hallEl.appendChild(li);
    return;
  }
  scores.forEach((value, index) => {
    const li = document.createElement('li');
    li.textContent = `${index + 1}. ${value}`;
    hallEl.appendChild(li);
  });
}

function showBanner(title: string, sub: string, showLevels: boolean, kind: BannerKind) {
  bannerTitle.textContent = title; bannerSub.textContent = sub;
  levelPicker.style.display = showLevels ? 'flex' : 'none';
  levelInput.style.display = showLevels ? 'block' : 'none';
  hallEl.style.display = kind === 'start' ? 'flex' : 'none';
  if (kind === 'start') renderHall();
  bannerKind = kind;
  banner.classList.remove('hidden');
}
function hideBanner() { banner.classList.add('hidden'); }

function startGame() {
  if (endBannerAt !== null || levelBannerAt !== null) return;
  startLevel = Math.max(1, Math.min(startLevel, 99));
  engine.snake_reset(game, startLevel);
  engine.snake_start(game);
  acc = 0; last = performance.now();
  shownScore = 0; popup = null; flashUntil = 0;
  lastRank = 0;
  startScreen = false;
  hideBanner();
}
function continueLevel() {
  autoContinueAt = null;
  engine.snake_start(game);
  acc = 0; last = performance.now();
  hideBanner();
}
function buzz(ms: number) {
  if (!vibrateOn) return;
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch {}
}
function togglePause() {
  const phase = engine.snake_state(game);
  if (phase === 1 || phase === 2) {
    engine.snake_pause(game);
    if (engine.snake_state(game) === 2) showBanner('Paused', 'Press Space or Start to resume', false, 'pause');
    else hideBanner();
  }
}
function onDeath(now: number) {
  const score = engine.snake_score(game);
  if (score > best) { best = score; saveBest(best); }
  $('best').textContent = String(best);
  lastRank = recordScore(score);
  sfx.die();
  buzz(VIBRATE_MS);
  endBannerAt = now + DEATH_PAUSE_MS;
  endWon = false;
}
function onWon(now: number) {
  const score = engine.snake_score(game);
  if (score > best) { best = score; saveBest(best); }
  $('best').textContent = String(best);
  lastRank = recordScore(score);
  sfx.win();
  buzz(VIBRATE_MS);
  endBannerAt = now + DEATH_PAUSE_MS;
  endWon = true;
}
function showDeathBanner() {
  const score = engine.snake_score(game);
  const cause = engine.snake_cause(game) === 1 ? 'Hit the wall' : 'Bit yourself';
  const rank = lastRank > 0 ? ` · New #${lastRank}` : '';
  showBanner('Game over', `${cause} · Score ${score}${rank} — Enter to retry`, false, 'over');
}
function showWonBanner() {
  const score = engine.snake_score(game);
  const rank = lastRank > 0 ? ` · New #${lastRank}` : '';
  showBanner('Board cleared!', `Score ${score}${rank} — Enter to play again`, false, 'over');
}
function onLevelUp(now: number) {
  sfx.level();
  flashUntil = now + LEVEL_FLASH_MS;
  levelBannerAt = now + LEVEL_FLASH_MS;
  rolling = true;
  barEl.style.transition = 'none';
  barEl.style.width = '100%';
  void barEl.offsetWidth;
  barEl.style.transition = '';
  barEl.classList.add('roll');
  window.setTimeout(() => {
    barEl.classList.remove('roll');
    barEl.style.transition = 'none';
    barEl.style.width = '0%';
    void barEl.offsetWidth;
    barEl.style.transition = '';
    rolling = false;
  }, 240);
}

function frame(now: number) {
  const dt = Math.min(now - last, MAX_FRAME_MS); last = now;
  if (engine.snake_state(game) === 1) {
    acc += dt;
    const step = engine.snake_speed_ms(game);
    while (acc >= step && engine.snake_state(game) === 1) {
      acc -= step;
      const before = engine.snake_score(game);
      const ev = engine.snake_tick(game);
      if (ev === 1) { sfx.eat(); buzz(12); lastEatAt = now; }
      else if (ev === 2) { sfx.bonus(); popup = { text: '+' + (engine.snake_score(game) - before), until: now + POPUP_MS }; }
      else if (ev === 3) { onDeath(now); break; }
      else if (ev === 4) { onLevelUp(now); break; }
      else if (ev === 5) { onWon(now); break; }
    }
  }
  if (endBannerAt !== null && now >= endBannerAt) {
    endBannerAt = null;
    if (endWon) showWonBanner();
    else showDeathBanner();
  }
  if (levelBannerAt !== null && now >= levelBannerAt) {
    levelBannerAt = null;
    showBanner(`Level ${engine.snake_level(game)}`, 'Get ready', false, 'level');
    autoContinueAt = now + AUTO_CONTINUE_MS;
  }
  if (autoContinueAt !== null && now >= autoContinueAt) {
    autoContinueAt = null;
    if (engine.snake_state(game) === 0) continueLevel();
  }
  render(now);
  requestAnimationFrame(frame);
}

const FONT3X5: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
};
const APPLE = ['..#..', '.###.', '#####', '.###.', '..#..'];
const BUG = ['#.#.#', '.###.', '#####', '.###.', '#.#.#'];

function drawGlyph(map: string[], x: number, y: number, s: number, color: string) {
  ctx.fillStyle = color;
  for (let r = 0; r < map.length; r++) {
    for (let c = 0; c < map[r].length; c++) {
      if (map[r][c] === '#' || map[r][c] === '1') ctx.fillRect(x + c * s, y + r * s, s, s);
    }
  }
}
function drawNumber(value: number, digits: number, x: number, y: number, s: number) {
  const text = String(value).padStart(digits, '0');
  for (let i = 0; i < text.length; i++) {
    drawGlyph(FONT3X5[text[i]], x + i * 4 * s, y, s, INK);
  }
}
function drawLcdHeader() {
  drawNumber(engine.snake_score(game), 4, 6, 4, 3);
  ctx.fillStyle = INK;
  ctx.fillRect(6, 20, 48, 2);
  const bonusTtl = engine.snake_bonus_ttl(game);
  if (bonusTtl > 0) {
    drawGlyph(BUG, canvas.width - 66, 5, 3, INK);
    drawNumber(bonusTtl, 2, canvas.width - 46, 4, 3);
  } else {
    drawGlyph(APPLE, canvas.width - 62, 5, 3, INK);
    drawNumber(GOAL - engine.snake_progress(game), 2, canvas.width - 44, 4, 3);
  }
  ctx.fillStyle = INK;
  ctx.fillRect(4, 24, canvas.width - 8, 2);
}
function drawCell(x: number, y: number, color: string, solid = false) {
  ctx.fillStyle = color;
  const pad = solid ? 0 : 1;
  ctx.fillRect(x * CELL_PX + pad, y * CELL_PX + BOARD_Y + pad, CELL_PX - pad * 2, CELL_PX - pad * 2);
}
function drawBoard(now: number) {
  ctx.fillStyle = INK;
  ctx.fillRect(0, BOARD_Y, canvas.width, 2);
  ctx.fillRect(0, BOARD_Y, 2, canvas.height - BOARD_Y);
  ctx.fillRect(canvas.width - 2, BOARD_Y, 2, canvas.height - BOARD_Y);
  ctx.fillRect(0, canvas.height - 2, canvas.width, 2);
  const wallCount = engine.snake_wall_count(game);
  for (let i = 0; i < wallCount; i++) {
    const x = engine.snake_wall_x(game, i), y = engine.snake_wall_y(game, i);
    drawCell(x, y, INK, true);
    ctx.fillStyle = PAPER;
    ctx.fillRect(x * CELL_PX, y * CELL_PX + BOARD_Y, CELL_PX, 1);
    ctx.fillRect(x * CELL_PX, y * CELL_PX + BOARD_Y, 1, CELL_PX);
  }
  if (Math.floor(now / FOOD_BLINK_MS) % 2 === 0) {
    const fx = engine.snake_food_x(game), fy = engine.snake_food_y(game);
    drawGlyph(APPLE, fx * CELL_PX + 1, fy * CELL_PX + BOARD_Y, 2, INK);
  }
  drawBonus(now);
  drawSnake(now);
}
function drawBonus(now: number) {
  const bx = engine.snake_bonus_x(game);
  if (bx < 0) return;
  const by = engine.snake_bonus_y(game), ttl = engine.snake_bonus_ttl(game);
  if (ttl <= BONUS_WARN_TTL && Math.floor(now / BONUS_BLINK_MS) % 2 !== 0) return;
  drawGlyph(BUG, bx * CELL_PX, by * CELL_PX + BOARD_Y, (CELL_PX * BONUS_CELLS) / 5, INK);
}
function drawLink(x: number, y: number, toPrev: [number, number], toNext: [number, number], isTail: boolean, puffed: boolean) {
  const cx = x * CELL_PX, cy = y * CELL_PX + BOARD_Y;
  ctx.fillStyle = INK;
  const inset = puffed ? 0 : isTail ? 2 : 1;
  ctx.fillRect(cx + inset, cy + inset, CELL_PX - inset * 2, CELL_PX - inset * 2);
  const arm = (raw: [number, number]) => {
    const dx = wrapDelta(raw[0]), dy = wrapDelta(raw[1]);
    if (dx === 1) ctx.fillRect(cx + 5, cy + 3, 5, 4);
    else if (dx === -1) ctx.fillRect(cx, cy + 3, 5, 4);
    else if (dy === 1) ctx.fillRect(cx + 3, cy + 5, 4, 5);
    else if (dy === -1) ctx.fillRect(cx + 3, cy, 4, 5);
  };
  arm(toPrev);
  if (!isTail) arm(toNext);
}
const wrapDelta = (d: number): number => (d > 1 ? -1 : d < -1 ? 1 : d);
function drawSnake(now: number) {
  if (endBannerAt !== null && Math.floor(now / DEATH_BLINK_MS) % 2 === 0) return;
  const length = engine.snake_len(game);
  const bump = engine.snake_bump(game);
  const cell = (i: number): [number, number] => [engine.snake_cell_x(game, i), engine.snake_cell_y(game, i)];
  for (let i = length - 1; i >= 1; i--) {
    const [x, y] = cell(i);
    const [px, py] = cell(i - 1);
    const [nx, ny] = i + 1 < length ? cell(i + 1) : [x * 2 - px, y * 2 - py];
    drawLink(x, y, [px - x, py - y], [nx - x, ny - y], i === length - 1, i === bump);
  }
  if (length === 0) return;
  const [hx, hy] = cell(0);
  const [nx, ny] = length > 1 ? cell(1) : [hx - 1, hy];
  const dx = wrapDelta(hx - nx), dy = wrapDelta(hy - ny);
  const chomping = engine.snake_food_x(game) === hx + dx && engine.snake_food_y(game) === hy + dy;
  const bx = hx * CELL_PX, by = hy * CELL_PX + BOARD_Y;
  const gulp = now - lastEatAt < 150 ? 1 : 0;
  ctx.fillStyle = INK;
  ctx.fillRect(bx - gulp, by - gulp, CELL_PX + gulp * 2, CELL_PX + gulp * 2);
  ctx.fillStyle = PAPER;
  if (dx !== 0) {
    const ex = dx === 1 ? bx + 6 : bx + 2;
    ctx.fillRect(ex, by + 2, 2, 2);
    ctx.fillRect(ex, by + 6, 2, 2);
    if (chomping) ctx.fillRect(dx === 1 ? bx + 8 : bx, by + 4, 2, 2);
  } else {
    const ey = dy === 1 ? by + 6 : by + 2;
    ctx.fillRect(bx + 2, ey, 2, 2);
    ctx.fillRect(bx + 6, ey, 2, 2);
    if (chomping) ctx.fillRect(bx + 4, dy === 1 ? by + 8 : by, 2, 2);
  }
}
function render(now: number) {
  canvas.style.filter = now < flashUntil ? 'invert(0.9)' : '';
  const shade = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  shade.addColorStop(0, '#c3d76c');
  shade.addColorStop(1, '#93ad41');
  ctx.fillStyle = shade; ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawLcdHeader();
  drawBoard(now);
  const score = engine.snake_score(game);
  if (score !== shownScore) {
    shownScore = score;
    scoreEl.classList.remove('pop');
    void scoreEl.offsetWidth;
    scoreEl.classList.add('pop');
  }
  scoreEl.textContent = String(score);
  levelEl.textContent = `Level ${engine.snake_level(game)}`;
  if (popup) {
    if (now > popup.until) popup = null;
    else {
      const age = 1 - (popup.until - now) / POPUP_MS;
      ctx.fillStyle = INK;
      ctx.font = 'bold 13px "Courier New",monospace';
      ctx.textAlign = 'center';
      ctx.fillText('BONUS ' + popup.text, canvas.width / 2, 64 - age * 10);
      ctx.textAlign = 'left';
    }
  }
  const progress = engine.snake_progress(game);
  if (!rolling) barEl.style.width = (progress / GOAL) * 100 + '%';
}

function confirmKey() {
  sfx.click();
  if (banner.classList.contains('hidden')) { togglePause(); return; }
  if (bannerKind === 'pause') togglePause();
  else if (bannerKind === 'level') continueLevel();
  else startGame();
}
function clearKey() {
  sfx.click();
  const phase = engine.snake_state(game);
  if (phase === 1 || phase === 2) togglePause();
}
function digitKey(digit: number) {
  sfx.click();
  if (startScreen && digit >= 1 && digit <= 9) {
    startLevel = digit;
    levelInput.value = '';
    [...levelPicker.children].forEach((child, i) => child.classList.toggle('picked', i === digit - 1));
  }
}
function steerKey(digit: number) {
  if (digit in STEER && engine.snake_state(game) === 1) {
    engine.snake_set_dir(game, STEER[digit]);
    sfx.turn();
  } else sfx.click();
}
function pressDigit(digit: number) {
  if (startScreen && digit >= 1 && digit <= 9) digitKey(digit);
  else steerKey(digit);
}
const STEER: Record<number, number> = { 2: 0, 4: 3, 6: 1, 8: 2 };
document.querySelectorAll<HTMLButtonElement>('#keypad button').forEach((key) => {
  key.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const label = key.dataset.k || '';
    if (label >= '0' && label <= '9') pressDigit(+label);
    else sfx.click();
  });
});
($('softL') as HTMLButtonElement).onclick = (e) => {
  (e.currentTarget as HTMLButtonElement).blur();
  confirmKey();
};
($('navi') as HTMLButtonElement).onclick = (e) => {
  (e.currentTarget as HTMLButtonElement).blur();
  confirmKey();
};
($('keyC') as HTMLButtonElement).onclick = (e) => {
  (e.currentTarget as HTMLButtonElement).blur();
  clearKey();
};

const KEYMAP: Record<string, number> = { ArrowUp: 0, w: 0, W: 0, ArrowRight: 1, d: 1, D: 1, ArrowDown: 2, s: 2, S: 2, ArrowLeft: 3, a: 3, A: 3 };
window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null;
  if (target && target.id === 'levelInput') return;
  if (!settingsEl.classList.contains('hidden')) { menuKey(e); return; }
  if (e.key in KEYMAP) { e.preventDefault(); engine.snake_set_dir(game, KEYMAP[e.key]); sfx.turn(); }
  else if (e.key >= '0' && e.key <= '9') pressDigit(+e.key);
  else if (e.key === ' ' || e.key === 'Escape') { e.preventDefault(); clearKey(); }
  else if (e.key === 'Enter') { e.preventDefault(); confirmKey(); }
});
let swipeStart: [number, number] | null = null;
canvas.addEventListener('touchstart', (e) => { swipeStart = [e.touches[0].clientX, e.touches[0].clientY]; }, { passive: true });
canvas.addEventListener('touchmove', (e) => {
  if (!swipeStart) return;
  const dx = e.touches[0].clientX - swipeStart[0], dy = e.touches[0].clientY - swipeStart[1];
  if (Math.abs(dx) < SWIPE_MIN_PX && Math.abs(dy) < SWIPE_MIN_PX) return;
  engine.snake_set_dir(game, Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
  swipeStart = [e.touches[0].clientX, e.touches[0].clientY];
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('click', () => { if (!banner.classList.contains('hidden')) startGame(); });
function applyScan() {
  if (scanEl) scanEl.style.display = loadPref(PREF_SCAN, '1') === '1' ? '' : 'none';
}
function applyTheme() {
  document.body.classList.toggle('light', loadPref(PREF_THEME, 'dark') === 'light');
}
function playStyleJingle(style: SoundStyle) {
  [523, 784, 1046].forEach((freq, order) => setTimeout(() => beep(freq, 110, 'square', 0.045, style), order * 110));
}
let menuMode: 'main' | 'style' = 'main';
let menuIndex = 0;
let lastPreview: { style: SoundStyle; at: number } | null = null;
const menuTitleEl = $('menuTitle');
const menuListEl = $('menuList');

function styleLabel(s: SoundStyle): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function previewStyle(s: SoundStyle) {
  const now = performance.now();
  if (lastPreview && lastPreview.style === s && now - lastPreview.at < 700) return;
  lastPreview = { style: s, at: now };
  playStyleJingle(s);
}
function menuItems(): { key: string; label: string; value: string }[] {
  if (menuMode === 'style') {
    return SOUND_STYLES.map((s) => ({
      key: s,
      label: (s === soundStyle ? '\u00bb ' : '\u00a0\u00a0\u00a0') + styleLabel(s),
      value: '',
    }));
  }
  return [
    { key: 'sound', label: 'Sound', value: soundOn ? 'On' : 'Off' },
    { key: 'style', label: 'Sound style', value: styleLabel(soundStyle) },
    { key: 'vibrate', label: 'Vibration', value: vibrateOn ? 'On' : 'Off' },
    { key: 'scan', label: 'Screen fx', value: loadPref(PREF_SCAN, '1') === '1' ? 'On' : 'Off' },
    { key: 'theme', label: 'Theme', value: loadPref(PREF_THEME, 'dark') === 'light' ? 'Light' : 'Dark' },
  ];
}
function renderMenu() {
  menuTitleEl.textContent = menuMode === 'style' ? 'Sound style' : 'Settings';
  menuListEl.innerHTML = '';
  menuItems().forEach((item, i) => {
    const li = document.createElement('li');
    li.className = 'menu-row' + (i === menuIndex ? ' cur' : '');
    const label = document.createElement('span');
    label.textContent = item.label;
    li.appendChild(label);
    if (item.value) {
      const value = document.createElement('b');
      value.textContent = item.value;
      li.appendChild(value);
    }
    if (menuMode === 'style') {
      li.addEventListener('pointerenter', () => { if (i !== menuIndex) previewStyle(SOUND_STYLES[i]); });
    }
    li.addEventListener('click', () => {
      if (menuIndex !== i) {
        menuIndex = i;
        if (menuMode === 'style') previewStyle(SOUND_STYLES[i]);
        renderMenu();
        return;
      }
      activateMenu();
    });
    menuListEl.appendChild(li);
  });
}
function menuMove(delta: number) {
  const len = menuItems().length;
  menuIndex = (menuIndex + delta + len) % len;
  renderMenu();
  if (menuMode === 'style') previewStyle(SOUND_STYLES[menuIndex]);
  else sfx.click();
}
function activateMenu() {
  const item = menuItems()[menuIndex];
  if (menuMode === 'style') {
    const s = SOUND_STYLES[menuIndex];
    soundStyle = s;
    savePref(PREF_STYLE, s);
    sfx.eat();
    menuMode = 'main';
    menuIndex = 1;
    renderMenu();
    return;
  }
  if (item.key === 'sound') {
    soundOn = !soundOn;
    savePref(PREF_SOUND, soundOn ? '1' : '0');
    if (soundOn) sfx.click();
  } else if (item.key === 'vibrate') {
    vibrateOn = !vibrateOn;
    savePref(PREF_VIBRATE, vibrateOn ? '1' : '0');
    buzz(20);
  } else if (item.key === 'scan') {
    const on = loadPref(PREF_SCAN, '1') !== '1';
    savePref(PREF_SCAN, on ? '1' : '0');
    applyScan();
  } else if (item.key === 'theme') {
    const light = loadPref(PREF_THEME, 'dark') !== 'light';
    savePref(PREF_THEME, light ? 'light' : 'dark');
    applyTheme();
  } else if (item.key === 'style') {
    menuMode = 'style';
    menuIndex = SOUND_STYLES.indexOf(soundStyle);
    renderMenu();
    previewStyle(soundStyle);
    return;
  }
  renderMenu();
}
function menuBackAction() {
  if (menuMode === 'style') {
    menuMode = 'main';
    menuIndex = 1;
    renderMenu();
  } else {
    toggleSettings(false);
  }
}
function menuKey(e: KeyboardEvent) {
  const up = e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W' || e.key === '2';
  const down = e.key === 'ArrowDown' || e.key === 's' || e.key === 'S' || e.key === '8';
  const select = e.key === 'Enter' || e.key === '5';
  const back = e.key === 'Escape' || e.key === 'c' || e.key === 'C' || e.key === 'Backspace' || e.key === '*';
  if (up) { e.preventDefault(); menuMove(-1); }
  else if (down) { e.preventDefault(); menuMove(1); }
  else if (select) { e.preventDefault(); activateMenu(); }
  else if (back) { e.preventDefault(); menuBackAction(); }
}
function toggleSettings(open?: boolean) {
  const hide = open === undefined ? !settingsEl.classList.contains('hidden') : !open;
  settingsEl.classList.toggle('hidden', hide);
  if (!hide) {
    if (engine.snake_state(game) === 1) togglePause();
    menuMode = 'main';
    menuIndex = 0;
    lastPreview = null;
    renderMenu();
  }
}
($('btnSettings') as HTMLButtonElement).onclick = (e) => {
  (e.currentTarget as HTMLButtonElement).blur();
  sfx.click();
  toggleSettings(true);
};
($('menuBack') as HTMLButtonElement).onclick = () => { sfx.click(); menuBackAction(); };
settingsEl.addEventListener('click', (e) => { if (e.target === settingsEl) toggleSettings(false); });
applyScan();
applyTheme();
document.addEventListener('visibilitychange', () => {
  if (document.hidden && engine.snake_state(game) === 1) togglePause();
});
window.addEventListener('pagehide', () => {
  if (destroyed) return;
  destroyed = true;
  engine.snake_destroy(game);
});
window.addEventListener('pageshow', (e) => {
  const evt = e as PageTransitionEvent;
  if (!evt.persisted || !destroyed) return;
  destroyed = false;
  game = engine.snake_create(BigInt(Date.now()));
  shownScore = 0; popup = null; flashUntil = 0;
  endBannerAt = null; endWon = false; levelBannerAt = null; autoContinueAt = null;
  startScreen = true;
  showBanner('Snake II', 'Pick a level, then Start', true, 'start');
});

showBanner('Snake II', 'Pick a level, then Start', true, 'start');
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

interface MatopeliDebug {
  score(): number;
  level(): number;
  state(): number;
  progress(): number;
  length(): number;
  head(): [number, number];
  food(): [number, number];
  dir(): [number, number];
  banner(): string;
}
if (import.meta.env.DEV) {
  (window as unknown as { __matopeli?: MatopeliDebug }).__matopeli = {
    score: () => engine.snake_score(game),
    level: () => engine.snake_level(game),
    state: () => engine.snake_state(game),
    progress: () => engine.snake_progress(game),
    length: () => engine.snake_len(game),
    head: () => [engine.snake_cell_x(game, 0), engine.snake_cell_y(game, 0)],
    food: () => [engine.snake_food_x(game), engine.snake_food_y(game)],
    dir: () => [
      engine.snake_cell_x(game, 0) - engine.snake_cell_x(game, 1),
      engine.snake_cell_y(game, 0) - engine.snake_cell_y(game, 1),
    ],
    banner: () => (banner.classList.contains('hidden') ? 'hidden' : bannerTitle.textContent || ''),
  };
}
requestAnimationFrame(frame);

export {};
