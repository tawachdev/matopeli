import type { OsApp, OsKeyEvent, OsKeyName, OsServices, Contact } from './types';
import { net } from './net';
import { createSmsApp } from './sms';
import { playTone, currentRingtone, saveRingtone } from './audio';

const OS_STORAGE_KEY = 'snake2_os_seen';

const services: OsServices = {
  contacts: (): Contact[] => {
    try {
      const raw = localStorage.getItem('snake2_contacts');
      const parsed: unknown = raw === null ? [] : JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((c): c is Contact => {
        if (typeof c !== 'object' || c === null) return false;
        const item = c as Record<string, unknown>;
        return typeof item.name === 'string' && typeof item.number === 'string';
      });
    } catch {
      return [];
    }
  },
  saveContacts: (list: Contact[]): void => {
    try {
      localStorage.setItem('snake2_contacts', JSON.stringify(list));
    } catch {}
  },
  playTone,
  ringtoneNotes: (): string => currentRingtone(),
  saveRingtone,
};

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
  action: () => void;
}

const menuEntries = (): MenuEntry[] => [
  { label: 'Messages', action: () => openApp(createSmsApp(services)) },
  { label: 'Games', action: () => launchSnake() },
  { label: 'Contacts', action: () => openAppById('contacts') },
  { label: 'Extras', action: () => openAppById('extras') },
  { label: 'Settings', action: () => openSettings() },
];

let appsById: Record<string, () => OsApp> = {};

function el(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function signalBar(): HTMLElement {
  const bar = el('div', 'os-signal');
  const online = net.online;
  bar.appendChild(el('span', 'os-batt', 'BAT'));
  const sig = el('b', 'os-sig', online ? 'SIGNAL' : 'NO SIGNAL');
  if (!online) sig.classList.add('os-off');
  bar.appendChild(sig);
  return bar;
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
  screenEl.insertBefore(signalBar(), clock);
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

function renderMenu(): void {
  if (!screenEl) return;
  screenEl.innerHTML = '';
  screenEl.appendChild(el('div', 'os-title', 'Menu'));
  const list = el('div', 'os-list');
  menuEntries().forEach((entry, i) => {
    const row = el('div', 'os-row', entry.label);
    if (i === menuIndex) row.classList.add('os-cur');
    list.appendChild(row);
  });
  screenEl.appendChild(list);
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
  activeApp.mount(screenEl);
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
  const start = document.getElementById('softL');
  if (start) {
    const banner = document.getElementById('banner');
    if (banner && !banner.classList.contains('hidden')) start.click();
  }
}

function openSettings(): void {
  hide();
  const gear = document.getElementById('btnSettings');
  if (gear) gear.click();
}

export function registerApps(map: Record<string, () => OsApp>): void {
  appsById = { ...appsById, ...map };
}

export function osOpen(): boolean {
  return root !== null && !root.classList.contains('hidden');
}

export function openOsMenu(): void {
  if (!root) return;
  const banner = document.getElementById('banner');
  const stateHidden = !banner || banner.classList.contains('hidden');
  if (!stateHidden) {
    const sub = banner && banner.querySelector('#bannerSub');
    if (sub && banner && banner.querySelector('#bannerTitle')?.textContent === 'Paused') {
      sub.textContent = 'Space resumes - hash menu';
    }
  }
  root.classList.remove('hidden');
  openMenu();
}

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

function handleOsKey(event: OsKeyEvent): void {
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
        if (!osOpen()) return;
        const target = e.target as HTMLElement;
        const label = target.closest('button')?.dataset.k || '';
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

window.addEventListener('os-home', () => openMenu());

net.onStatus(() => {
  if (screen === 'idle') renderIdle();
});

export function initOs(): void {
  root = document.getElementById('osRoot');
  screenEl = document.getElementById('osScreen');
  if (!root || !screenEl) return;
  wireKeys();
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
