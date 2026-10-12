import { initOs, registerApps, openApp } from './os';
import type { OsApp, OsServices } from './types';
import { createCalculatorApp } from './apps/calculator';
import { createClockApp } from './apps/clock';
import { createContactsApp } from './apps/contacts';
import { createComposerApp } from './apps/composer';
import { playTone, currentRingtone, saveRingtone } from './audio';
import type { Contact } from './types';

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

function createExtrasApp(): OsApp {
  const items = [
    { label: 'Calculator', open: () => openApp(createCalculatorApp(services)) },
    { label: 'Composer', open: () => openApp(createComposerApp(services)) },
    { label: 'Clock', open: () => openApp(createClockApp(services)) },
  ];
  let root: HTMLElement | null = null;
  let index = 0;
  const render = (): void => {
    if (!root) return;
    root.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'os-title';
    title.textContent = 'Extras';
    root.appendChild(title);
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
    back.addEventListener('click', () => window.dispatchEvent(new CustomEvent('os-home')));
    soft.appendChild(back);
    root.appendChild(soft);
  };
  return {
    id: 'extras',
    title: 'Extras',
    mount(node: HTMLElement): void {
      root = node;
      render();
    },
    unmount(): void {
      root = null;
    },
    onKey(event): void {
      if (event.name === 'up') {
        index = (index + items.length - 1) % items.length;
        render();
      } else if (event.name === 'down') {
        index = (index + 1) % items.length;
        render();
      } else if (event.name === 'select') {
        items[index].open();
      } else if (event.name === 'back') {
        window.dispatchEvent(new CustomEvent('os-home'));
      }
    },
  };
}

registerApps({
  contacts: () => createContactsApp(services),
  extras: () => createExtrasApp(),
});

initOs();
