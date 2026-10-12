import type { OsApp, OsKeyEvent, OsKeyName } from './types';
import { net } from './net';
import { playTone } from './audio';
import { emitPhoneEvent, onPhoneEvent, PhoneEvent } from './events';

const OS_STORAGE_KEY = 'snake2_os_seen';

type Screen = 'idle' | 'menu' | 'app';

let root: HTMLElement | null = null;
let screenEl: HTMLElement | null = null;
let screen: Screen = 'idle';
let menuIndex = 0;
let activeApp: OsApp | null = null;
let bootDone = false;
let unreadCount = 0;
let clockTimer: ReturnType<typeof setInterval> | null = null;

interface MenuEntry {
  label: string;
  icon: MenuIcon;
  action: () => void;
}

const menuEntries = (): MenuEntry[] => [
  { label: 'Messages', icon: 'messages', action: () => openAppById('messages') },
  { label: 'Call register', icon: 'calls', action: () => openAppById('callreg') },
  { label: 'Tones', icon: 'tones', action: () => openAppById('tones') },
  { label: 'Settings', icon: 'settings', action: () => openSettings() },
  { label: 'Games', icon: 'games', action: () => openAppById('games') },
  { label: 'Calculator', icon: 'calculator', action: () => openAppById('calculator') },
  { label: 'Reminders', icon: 'reminders', action: () => openAppById('reminders') },
  { label: 'Names', icon: 'names', action: () => openAppById('contacts') },
];

let appsById: Record<string, () => OsApp> = {};

function keypadTonesOn(): boolean {
  try {
    return localStorage.getItem('snake2_keypad_tones') !== '0';
  } catch {
    return true;
  }
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SIGNAL_BAR_HEIGHTS = [4, 6, 8, 10];

function signalIcon(online: boolean): string {
  const bars = SIGNAL_BAR_HEIGHTS.map((height, i) => {
    const opacity = online || i === 0 ? 1 : 0.25;
    return `<rect x="${i * 4}" y="${10 - height}" width="2.5" height="${height}" rx="0.5" fill="currentColor" opacity="${opacity}"/>`;
  }).join('');
  return `<svg width="15" height="10" viewBox="0 0 15 10" aria-hidden="true">${bars}</svg>`;
}

const BATTERY_ICON =
  '<svg width="18" height="10" viewBox="0 0 18 10" aria-hidden="true">' +
  '<rect x="0.5" y="0.5" width="15" height="9" rx="1.5" fill="none" stroke="currentColor"/>' +
  '<rect x="16" y="3" width="1.5" height="4" fill="currentColor"/>' +
  '<rect x="2.5" y="2.5" width="11" height="5" rx="0.5" fill="currentColor"/></svg>';

function signalBar(): HTMLElement {
  const bar = el('div', 'os-signal');
  const online = net.online;
  const sig = el('span', online ? 'os-sig-wrap' : 'os-sig-wrap os-off');
  sig.innerHTML = `${signalIcon(online)}<span>${online ? 'SIGNAL' : 'NO SIGNAL'}</span>`;
  const bat = el('span', 'os-bat-wrap');
  bat.innerHTML = BATTERY_ICON;
  bar.appendChild(sig);
  bar.appendChild(bat);
  return bar;
}

const MENU_ICON_PATHS = {
  messages: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 7l10 6 10-6"/>',
  calls: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  tones: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  games: '<rect x="2" y="7" width="20" height="10" rx="4"/><path d="M7 12h4M9 10v4M15 11h.01M17 13h.01"/>',
  calculator: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h2M12 12h2M8 16h2M12 16h4"/>',
  reminders: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4"/>',
  names: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
} as const satisfies Record<string, string>;

type MenuIcon = keyof typeof MENU_ICON_PATHS;

function menuIcon(name: MenuIcon): HTMLElement {
  const wrap = el('span', 'os-ico');
  wrap.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${MENU_ICON_PATHS[name]}</svg>`;
  return wrap;
}

function renderIdle(): void {
  if (!screenEl) return;
  screenEl.innerHTML = '';
  screenEl.appendChild(el('div', 'os-title', 'matopeli'));
  const clock = el('div', 'os-clock', '--:--');
  screenEl.appendChild(clock);
  screenEl.appendChild(el('div', 'os-date', ''));
  const mid = el('div', 'os-idle-mid');
  if (unreadCount > 0) mid.appendChild(el('div', 'os-newmsg', `MESSAGES ${unreadCount}`));
  screenEl.appendChild(mid);
  const soft = el('div', 'os-soft');
  soft.appendChild(el('span', '', 'Menu'));
  const back = el('button', 'os-back', 'Games');
  back.addEventListener('click', () => launchSnake());
  soft.appendChild(back);
  screenEl.appendChild(soft);
  screenEl.insertBefore(signalBar(), screenEl.firstChild);
  const dateEl = screenEl.querySelector('.os-date');
  const tick = (): void => {
    const now = new Date();
    clock.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (dateEl) dateEl.textContent = now.toDateString();
  };
  tick();
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = setInterval(tick, 1000);
}

const MENU_VISIBLE = 6;
let menuTop = 0;

function renderMenu(): void {
  if (!screenEl) return;
  screenEl.innerHTML = '';
  screenEl.appendChild(signalBar());
  screenEl.appendChild(el('div', 'os-title', 'Menu'));
  const body = el('div', 'os-body');
  const list = el('div', 'os-list');
  if (menuIndex < menuTop) menuTop = menuIndex;
  if (menuIndex >= menuTop + MENU_VISIBLE) menuTop = menuIndex - MENU_VISIBLE + 1;
  menuEntries()
    .slice(menuTop, menuTop + MENU_VISIBLE)
    .forEach((entry, offset) => {
      const i = menuTop + offset;
      const row = el('div', 'os-row');
      row.appendChild(el('span', 'os-num', String(i + 1)));
      row.appendChild(menuIcon(entry.icon));
      row.appendChild(el('span', '', entry.label));
      if (i === menuIndex) row.classList.add('os-cur');
      row.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        menuIndex = i;
        entry.action();
      });
      list.appendChild(row);
    });
  body.appendChild(list);
  screenEl.appendChild(body);
  const soft = el('div', 'os-soft');
  soft.appendChild(el('span', '', 'Select'));
  const back = el('button', 'os-back', 'Back');
  back.addEventListener('click', () => goIdle());
  soft.appendChild(back);
  screenEl.appendChild(soft);
}

function renderAppShell(): void {
  if (!screenEl || !activeApp) return;
  screenEl.innerHTML = '';
  screenEl.appendChild(signalBar());
  const host = el('div', 'os-app');
  screenEl.appendChild(host);
  activeApp.mount(host);
}

function rerender(): void {
  if (screen === 'idle') renderIdle();
  else if (screen === 'menu') renderMenu();
  else renderAppShell();
}

function goIdle(): void {
  closeApp();
  screen = 'idle';
  rerender();
}

function openMenu(): void {
  closeApp();
  screen = 'menu';
  menuIndex = 0;
  menuTop = 0;
  rerender();
}

export function openApp(app: OsApp): void {
  closeApp();
  activeApp = app;
  screen = 'app';
  rerender();
}

function openAppById(id: string): void {
  const factory = appsById[id];
  if (factory) openApp(factory());
}

function closeApp(): void {
  if (activeApp) {
    activeApp.unmount();
    activeApp = null;
  }
  if (clockTimer) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
}

function launchSnake(): void {
  closeApp();
  hide();
  const navi = document.getElementById('navi');
  const banner = document.getElementById('banner');
  if (navi && banner && !banner.classList.contains('hidden')) navi.click();
}

export { launchSnake };

function openSettings(): void {
  hide();
  emitPhoneEvent(PhoneEvent.settingsRequested);
}

export function registerApps(map: Record<string, () => OsApp>): void {
  appsById = { ...appsById, ...map };
}

export function osOpen(): boolean {
  return root !== null && !root.classList.contains('hidden');
}

export function openOsMenu(): void {
  if (!root) return;
  emitPhoneEvent(PhoneEvent.menuOpened);
  root.classList.remove('hidden');
  openMenu();
}

onPhoneEvent(PhoneEvent.gameExit, () => {
  if (!root) return;
  root.classList.remove('hidden');
  openAppById('games');
});

export function hide(): void {
  if (root) root.classList.add('hidden');
}

function keyEvent(e: KeyboardEvent | { key: string }): OsKeyEvent | null {
  const key = e.key;
  if (key === 'ArrowUp' || key === 'w' || key === 'W') return { name: 'up' };
  if (key === 'ArrowDown' || key === 's' || key === 'S') return { name: 'down' };
  if (key === 'ArrowLeft' || key === 'a' || key === 'A') return { name: 'left' };
  if (key === 'ArrowRight' || key === 'd' || key === 'D') return { name: 'right' };
  if (key === 'Enter' || key === ' ') return { name: 'select' };
  if (key === 'Escape' || key === 'c' || key === 'C') return { name: 'back' };
  if (key === 'Backspace') return { name: 'clear' };
  if (key === '*') return { name: 'star' };
  if (key === '#') return { name: 'hash' };
  if (key >= '0' && key <= '9') return { name: 'digit', digit: Number(key) };
  return null;
}

function keypadAsNavigation(raw: OsKeyEvent): OsKeyEvent {
  if (raw.name !== 'digit') return raw;
  const onListScreen = screen === 'menu' || (screen === 'app' && activeApp !== null && !activeApp.acceptsDigits?.());
  if (!onListScreen) return raw;
  if (raw.digit === 2) return { name: 'up' };
  if (raw.digit === 8) return { name: 'down' };
  if (raw.digit === 5) return { name: 'select' };
  return raw;
}

function handleOsKey(raw: OsKeyEvent): void {
  const event = keypadAsNavigation(raw);
  if (keypadTonesOn() && (event.name === 'up' || event.name === 'down' || event.name === 'select' || event.name === 'back')) {
    playTone(1300, 14);
  }
  if (screen === 'app' && activeApp) {
    activeApp.onKey(event);
    return;
  }
  if (screen === 'idle') {
    if (event.name === 'select') openMenu();
    else if (event.name === 'digit' && event.digit === 5) openMenu();
    return;
  }
  const entries = menuEntries();
  if (event.name === 'up') {
    menuIndex = (menuIndex + entries.length - 1) % entries.length;
    rerender();
  } else if (event.name === 'down') {
    menuIndex = (menuIndex + 1) % entries.length;
    rerender();
  } else if (event.name === 'select') {
    entries[menuIndex].action();
  } else if (event.name === 'back') {
    goIdle();
  }
}

function wireKeys(): void {
  window.addEventListener(
    'keydown',
    (e) => {
      if (!bootDone) {
        finishBoot();
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (!osOpen()) {
        if (e.key === '#') {
          e.preventDefault();
          e.stopImmediatePropagation();
          openOsMenu();
        }
        return;
      }
      if (e.key === '#' && screen !== 'app') {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeApp();
        hide();
        return;
      }
      const event = keyEvent(e);
      if (!event) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      handleOsKey(event);
    },
    true
  );
  const keypad = document.getElementById('keypad');
  if (keypad) {
    keypad.addEventListener(
      'pointerdown',
      (e) => {
        const target = e.target as HTMLElement;
        const label = target.closest('button')?.dataset.k || '';
        if (!osOpen()) {
          if (label === '#' && bootDone) {
            e.preventDefault();
            e.stopImmediatePropagation();
            openOsMenu();
          }
          return;
        }
        const event: OsKeyEvent | null =
          label >= '0' && label <= '9'
            ? { name: 'digit', digit: Number(label) }
            : label === '*'
              ? { name: 'star' }
              : label === '#'
                ? { name: 'hash' }
                : null;
        if (event) {
          e.preventDefault();
          e.stopImmediatePropagation();
          handleOsKey(event);
        }
      },
      true
    );
  }
  const navi = document.getElementById('navi');
  if (navi) {
    navi.addEventListener(
      'pointerdown',
      (e) => {
        if (!osOpen()) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        handleOsKey({ name: 'select' });
      },
      true
    );
  }
  for (const [id, key] of Object.entries(SCROLL_KEYS)) {
    document.getElementById(id)?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      window.dispatchEvent(new KeyboardEvent('keydown', { key }));
    });
  }
  const keyC = document.getElementById('keyC');
  if (keyC) {
    keyC.addEventListener(
      'pointerdown',
      (e) => {
        if (!osOpen()) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        handleOsKey({ name: 'back' });
      },
      true
    );
  }
}

const BACKLIGHT_MS = 6000;
const SCROLL_KEYS = { keyUp: 'ArrowUp', keyDown: 'ArrowDown' } as const;
function wireBacklight(): void {
  const lens = document.querySelector('.lens');
  if (!lens) return;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const light = (): void => {
    lens.classList.add('lit');
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => lens.classList.remove('lit'), BACKLIGHT_MS);
  };
  document.querySelector('.phone')?.addEventListener(
    'pointerdown',
    (e) => {
      if (!(e.target as HTMLElement).closest('button')) return;
      light();
      if (!bootDone) {
        e.preventDefault();
        e.stopImmediatePropagation();
        finishBoot();
      }
    },
    true
  );
  window.addEventListener('keydown', light, true);
  light();
}

function runBoot(): void {
  const boot = document.getElementById('bootScreen');
  if (!boot) {
    bootDone = true;
    return;
  }
  boot.classList.remove('hidden');
  const timer = setTimeout(finishBoot, 2400);
  const skip = (): void => {
    clearTimeout(timer);
    finishBoot();
  };
  boot.addEventListener('pointerdown', skip, { once: true });
}

function finishBoot(): void {
  if (bootDone) return;
  bootDone = true;
  const boot = document.getElementById('bootScreen');
  if (boot) boot.classList.add('hidden');
  try {
    localStorage.setItem(OS_STORAGE_KEY, '1');
  } catch {}
  net.connect();
  goIdle();
  root?.classList.remove('hidden');
}

export function markMessageRead(): void {
  unreadCount = 0;
  if (screen === 'idle') renderIdle();
}

net.onMessage((): void => {
  const inMessages = screen === 'app' && activeApp !== null && activeApp.id === 'messages';
  if (!inMessages) {
    unreadCount += 1;
    if (screen === 'idle') renderIdle();
  }
});

onPhoneEvent(PhoneEvent.home, openMenu);

net.onStatus(() => {
  if (screen === 'idle') renderIdle();
});

export function initOs(): void {
  root = document.getElementById('osRoot');
  screenEl = document.getElementById('osScreen');
  if (!root || !screenEl) return;
  wireKeys();
  wireBacklight();
  runBoot();
  if (import.meta.env.DEV) {
    (window as unknown as { __os?: { hide(): void; open(): void; visible(): boolean } }).__os = {
      hide: () => {
        finishBoot();
        hide();
      },
      open: () => openOsMenu(),
      visible: () => osOpen(),
    };
  }
}

export type { OsKeyEvent, OsKeyName };
