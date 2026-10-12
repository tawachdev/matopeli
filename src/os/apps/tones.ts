import type { OsApp, OsKeyEvent } from '../types';
import { playSequence, currentRingtone } from '../audio';
import { emitPhoneEvent, PhoneEvent } from '../events';

const RING_KEY = 'snake2_ring_tone';
const ALERT_KEY = 'snake2_msg_alert';
const KEYPAD_KEY = 'snake2_keypad_tones';
const VIBRATE_KEY = 'snake2_vibrate_alert';

type ToneView = 'menu' | 'ring' | 'alert';

interface RingTone {
  label: string;
  notes: string;
}

const RING_TONES: RingTone[] = [
  { label: 'Nokia tune', notes: 'e5 d5 f4 g4 c5 b4 e4 b4 a4' },
  { label: 'Bee', notes: 'c5 e5 g5 e5 c5' },
  { label: 'Echo', notes: 'a4 - a4 - c5' },
  { label: 'Composed', notes: '' },
];

const ALERTS: string[] = ['Beep once', 'Beep twice', 'Fancy', 'Silent'];

function load(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function messageAlert(): string {
  return load(ALERT_KEY, 'Fancy');
}

export function vibrateAlert(): boolean {
  return load(VIBRATE_KEY, '1') === '1';
}

export function keypadTones(): boolean {
  return load(KEYPAD_KEY, '1') === '1';
}

export function ringingToneNotes(): string {
  const label = load(RING_KEY, 'Nokia tune');
  if (label === 'Composed') return currentRingtone();
  return RING_TONES.find((tone) => tone.label === label)?.notes || RING_TONES[0].notes;
}

export function createTonesApp(openComposer: () => void): OsApp {
  let root: HTMLElement | null = null;
  let view: ToneView = 'menu';
  let index = 0;
  let alertIndex = ALERTS.indexOf(messageAlert());

  const el = (tag: string, cls: string, text?: string): HTMLElement => {
    const node = document.createElement(tag);
    node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const menuItems = (): string[] => ['Ringing tone', 'Message alert tone', 'Keypad tones', 'Vibrating alert', 'Composer'];

  const renderShell = (title: string, hint: string): void => {
    if (!root) return;
    root.innerHTML = '';
    root.className = 'os-screen';
    root.appendChild(el('div', 'os-title', title));
    const body = el('div', 'os-body');
    root.appendChild(body);
    const soft = el('div', 'os-soft');
    soft.appendChild(el('span', 'os-hint', hint));
    const back = el('button', 'os-back', 'Back');
    back.addEventListener('click', () => onKey({ name: 'back' }));
    soft.appendChild(back);
    root.appendChild(soft);
  };

  const renderMenu = (): void => {
    renderShell('Tones', '5 select');
    const body = root?.querySelector('.os-body');
    if (!body) return;
    const list = el('div', 'os-list');
    menuItems().forEach((label, i) => {
      const row = el('div', 'os-row', label);
      let value = '';
      if (i === 0) value = load(RING_KEY, 'Nokia tune');
      else if (i === 1) value = messageAlert();
      else if (i === 2) value = keypadTones() ? 'On' : 'Off';
      else if (i === 3) value = vibrateAlert() ? 'On' : 'Off';
      else if (i === 4) value = '';
      row.appendChild(el('span', 'os-val', value));
      if (i === index) row.classList.add('os-cur');
      list.appendChild(row);
    });
    body.appendChild(list);
  };

  const renderRing = (): void => {
    renderShell('Ringing tone', '5 play+set');
    const body = root?.querySelector('.os-body');
    if (!body) return;
    const list = el('div', 'os-list');
    RING_TONES.forEach((tone, i) => {
      const row = el('div', 'os-row', tone.label);
      if (tone.label === load(RING_KEY, 'Nokia tune')) row.appendChild(el('span', 'os-val', 'SET'));
      if (i === index) row.classList.add('os-cur');
      list.appendChild(row);
    });
    body.appendChild(list);
  };

  const renderAlert = (): void => {
    renderShell('Message alert', '5 set');
    const body = root?.querySelector('.os-body');
    if (!body) return;
    const list = el('div', 'os-list');
    ALERTS.forEach((label, i) => {
      const row = el('div', 'os-row', label);
      if (label === messageAlert()) row.appendChild(el('span', 'os-val', 'SET'));
      if (i === alertIndex) row.classList.add('os-cur');
      list.appendChild(row);
    });
    body.appendChild(list);
  };

  const render = (): void => {
    if (view === 'menu') renderMenu();
    else if (view === 'ring') renderRing();
    else renderAlert();
  };

  const onKey = (event: OsKeyEvent): void => {
    if (view === 'menu') {
      const count = menuItems().length;
      if (event.name === 'up') {
        index = (index + count - 1) % count;
        renderMenu();
      } else if (event.name === 'down') {
        index = (index + 1) % count;
        renderMenu();
      } else if (event.name === 'select') {
        if (index === 0) {
          view = 'ring';
          index = 0;
          renderRing();
        } else if (index === 1) {
          view = 'alert';
          alertIndex = Math.max(0, ALERTS.indexOf(messageAlert()));
          renderAlert();
        } else if (index === 2) {
          save(KEYPAD_KEY, keypadTones() ? '0' : '1');
          renderMenu();
        } else if (index === 3) {
          save(VIBRATE_KEY, vibrateAlert() ? '0' : '1');
          renderMenu();
        } else if (index === 4) {
          openComposer();
        }
      } else if (event.name === 'back') {
        emitPhoneEvent(PhoneEvent.home);
      }
      return;
    }
    if (view === 'ring') {
      if (event.name === 'up') {
        index = (index + RING_TONES.length - 1) % RING_TONES.length;
        renderRing();
      } else if (event.name === 'down') {
        index = (index + 1) % RING_TONES.length;
        renderRing();
      } else if (event.name === 'select') {
        const tone = RING_TONES[index];
        save(RING_KEY, tone.label);
        playSequence(tone.label === 'Composed' ? currentRingtone() : tone.notes);
        renderRing();
      } else if (event.name === 'back') {
        view = 'menu';
        renderMenu();
      }
      return;
    }
    if (event.name === 'up') {
      alertIndex = (alertIndex + ALERTS.length - 1) % ALERTS.length;
      renderAlert();
    } else if (event.name === 'down') {
      alertIndex = (alertIndex + 1) % ALERTS.length;
      renderAlert();
    } else if (event.name === 'select') {
      save(ALERT_KEY, ALERTS[alertIndex]);
      if (ALERTS[alertIndex] === 'Beep once') playSequence('a5');
      else if (ALERTS[alertIndex] === 'Beep twice') playSequence('a5 - a5');
      else if (ALERTS[alertIndex] === 'Fancy') playSequence('a5 c6 a5 c6');
      renderAlert();
    } else if (event.name === 'back') {
      view = 'menu';
      renderMenu();
    }
  };

  return {
    id: 'tones',
    title: 'Tones',
    mount(node: HTMLElement): void {
      root = node;
      render();
    },
    unmount(): void {
      root = null;
    },
    onKey,
  };
}
