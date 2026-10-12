import { initOs, registerApps, openApp, launchSnake } from './os';
import type { OsApp, OsServices, OsKeyEvent } from './types';
import type { Contact } from './types';
import { createCalculatorApp } from './apps/calculator';
import { createClockApp } from './apps/clock';
import { createContactsApp } from './apps/contacts';
import { createComposerApp } from './apps/composer';
import { createPairsApp } from './apps/pairsii';
import { createCallRegisterApp, createCallScreenApp } from './apps/callreg';
import { createRemindersApp } from './apps/reminders';
import { createTonesApp } from './apps/tones';
import { createSmsApp } from './sms';
import { playTone, currentRingtone, saveRingtone } from './audio';
import { emitPhoneEvent, onCallRequested, PhoneEvent } from './events';

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

function createSubmenuApp(id: string, title: string, items: { label: string; open: () => void }[]): OsApp {
  let root: HTMLElement | null = null;
  let index = 0;
  const render = (): void => {
    if (!root) return;
    root.innerHTML = '';
    root.className = 'os-screen';
    const heading = document.createElement('div');
    heading.className = 'os-title';
    heading.textContent = title;
    root.appendChild(heading);
    const list = document.createElement('div');
    list.className = 'os-list';
    items.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'os-row' + (i === index ? ' os-cur' : '');
      row.textContent = item.label;
      list.appendChild(row);
    });
    root.appendChild(list);
    const soft = document.createElement('div');
    soft.className = 'os-soft';
    const hint = document.createElement('span');
    hint.className = 'os-hint';
    hint.textContent = '5 open';
    soft.appendChild(hint);
    const back = document.createElement('button');
    back.className = 'os-back';
    back.textContent = 'Back';
    back.addEventListener('click', () => emitPhoneEvent(PhoneEvent.home));
    soft.appendChild(back);
    root.appendChild(soft);
  };
  return {
    id,
    title,
    mount(node: HTMLElement): void {
      root = node;
      render();
    },
    unmount(): void {
      root = null;
    },
    onKey(event: OsKeyEvent): void {
      if (event.name === 'up') {
        index = (index + items.length - 1) % items.length;
        render();
      } else if (event.name === 'down') {
        index = (index + 1) % items.length;
        render();
      } else if (event.name === 'select') {
        items[index].open();
      } else if (event.name === 'back') {
        emitPhoneEvent(PhoneEvent.home);
      }
    },
  };
}

const gamesMenu = (): OsApp =>
  createSubmenuApp('games', 'Games', [
    { label: 'Snake II', open: () => launchSnake() },
    { label: 'Pairs II', open: () => openApp(createPairsApp(services)) },
  ]);

registerApps({
  messages: () => createSmsApp(services),
  callreg: () => createCallRegisterApp(),
  tones: () => createTonesApp(() => openApp(createComposerApp(services))),
  games: gamesMenu,
  calculator: () => createCalculatorApp(),
  reminders: () =>
    createSubmenuApp('reminders', 'Reminders', [
      { label: 'Reminders', open: () => openApp(createRemindersApp()) },
      { label: 'Clock alarm', open: () => openApp(createClockApp(services)) },
    ]),
  contacts: () => createContactsApp(services),
});

onCallRequested((contact) => openApp(createCallScreenApp(contact.number, contact.name)));

initOs();
