import type { OsApp, OsKeyEvent, OsServices } from '../types';
import { playTone } from '../audio';

type CallType = 'dialled' | 'received' | 'missed';

interface CallEntry {
  type: CallType;
  name: string;
  number: string;
  at: number;
}

const STORAGE_KEY = 'snake2_calls';
const MAX_ENTRIES = 30;

function isCallEntry(value: unknown): value is CallEntry {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    (item.type === 'dialled' || item.type === 'received' || item.type === 'missed') &&
    typeof item.name === 'string' &&
    typeof item.number === 'string' &&
    typeof item.at === 'number'
  );
}

function readCalls(): CallEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCallEntry);
  } catch {
    return [];
  }
}

function writeCalls(list: CallEntry[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    return;
  }
}

function appendCall(entry: CallEntry): void {
  const list = readCalls();
  list.push(entry);
  writeCalls(list.length > MAX_ENTRIES ? list.slice(list.length - MAX_ENTRIES) : list);
}

type RegView = 'menu' | 'list' | 'confirm';

const MENU: { label: string; type: CallType | null }[] = [
  { label: 'Dialled numbers', type: 'dialled' },
  { label: 'Received calls', type: 'received' },
  { label: 'Missed calls', type: 'missed' },
  { label: 'Erase all', type: null },
];

export function createCallRegisterApp(services: OsServices): OsApp {
  let root: HTMLElement | null = null;
  let view: RegView = 'menu';
  let cursor = 0;
  let currentType: CallType = 'dialled';
  let entries: CallEntry[] = [];

  function renderShell(): void {
    if (root !== null) root.textContent = '';
    const title = document.createElement('div');
    title.className = 'os-title';
    title.textContent = 'Call register';
    root?.append(title);
  }

  function makeSoft(): HTMLElement {
    const soft = document.createElement('div');
    soft.className = 'os-soft';
    const hint = document.createElement('span');
    hint.className = 'os-hint';
    hint.textContent = '';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'os-back';
    back.textContent = 'Back';
    soft.append(hint, back);
    return soft;
  }

  function renderMenu(): void {
    view = 'menu';
    cursor = Math.min(cursor, MENU.length - 1);
    renderShell();
    const list = document.createElement('div');
    list.className = 'os-list';
    MENU.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'os-row' + (i === cursor ? ' os-cur' : '');
      const label = document.createElement('span');
      label.textContent = item.label;
      row.append(label);
      list.append(row);
    });
    root?.append(list, makeSoft());
  }

  function renderList(): void {
    view = 'list';
    cursor = 0;
    renderShell();
    entries = readCalls()
      .filter((entry) => entry.type === currentType)
      .sort((a, b) => b.at - a.at);
    const list = document.createElement('div');
    list.className = 'os-list';
    if (entries.length === 0) {
      const row = document.createElement('div');
      row.className = 'os-row';
      const span = document.createElement('span');
      span.textContent = 'Empty';
      row.append(span);
      list.append(row);
    } else {
      entries.forEach((entry, i) => {
        const row = document.createElement('div');
        row.className = 'os-row' + (i === cursor ? ' os-cur' : '');
        const name = document.createElement('span');
        name.textContent = entry.name;
        const num = document.createElement('span');
        num.className = 'os-val';
        num.textContent = entry.number;
        row.append(name, num);
        list.append(row);
      });
    }
    root?.append(list, makeSoft());
  }

  function renderConfirm(): void {
    view = 'confirm';
    renderShell();
    const list = document.createElement('div');
    list.className = 'os-list';
    const row = document.createElement('div');
    row.className = 'os-row os-cur';
    const span = document.createElement('span');
    span.textContent = 'Erase? 5 yes C no';
    row.append(span);
    list.append(row);
    root?.append(list, makeSoft());
  }

  return {
    id: 'callreg',
    title: 'Call register',
    mount(target: HTMLElement): void {
      root = target;
      root.className = 'os-screen';
      cursor = 0;
      renderMenu();
    },
    unmount(): void {
      if (root !== null) root.textContent = '';
      root = null;
      entries = [];
    },
    onKey(event: OsKeyEvent): void {
      if (view === 'menu') {
        if (event.name === 'back') {
          window.dispatchEvent(new CustomEvent('os-home'));
        } else if (event.name === 'up' || event.name === 'down') {
          cursor =
            event.name === 'up'
              ? (cursor + MENU.length - 1) % MENU.length
              : (cursor + 1) % MENU.length;
          renderMenu();
        } else if (event.name === 'select') {
          const item = MENU[cursor];
          if (item === undefined) return;
          if (item.type === null) renderConfirm();
          else {
            currentType = item.type;
            renderList();
          }
        }
      } else if (view === 'list') {
        if (event.name === 'back') {
          renderMenu();
        } else if (event.name === 'up' || event.name === 'down') {
          if (entries.length === 0) return;
          cursor =
            event.name === 'up'
              ? Math.max(0, cursor - 1)
              : Math.min(entries.length - 1, cursor + 1);
          renderList();
        }
      } else if (view === 'confirm') {
        if (event.name === 'select' || (event.name === 'digit' && event.digit === 5)) {
          writeCalls([]);
          renderMenu();
        } else if (event.name === 'back') {
          renderMenu();
        }
      }
    },
  };
}

export function createCallScreenApp(number: string, name: string): OsApp {
  let root: HTMLElement | null = null;
  let timerId = 0;
  let startedAt = 0;
  let ended = false;
  let timeText: HTMLElement | null = null;

  function stopTimer(): void {
    if (timerId !== 0) {
      window.clearInterval(timerId);
      timerId = 0;
    }
  }

  function elapsedText(): string {
    const total = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    return mm + ':' + ss;
  }

  function endCall(): void {
    if (ended) return;
    ended = true;
    stopTimer();
    appendCall({ type: 'dialled', name, number, at: Date.now() });
    window.dispatchEvent(new CustomEvent('os-home'));
  }

  return {
    id: 'callscreen',
    title: 'Calling',
    mount(target: HTMLElement): void {
      root = target;
      root.className = 'os-screen';
      startedAt = Date.now();
      ended = false;
      const title = document.createElement('div');
      title.className = 'os-title';
      title.textContent = 'Calling';
      const list = document.createElement('div');
      list.className = 'os-list';
      const nameRow = document.createElement('div');
      nameRow.className = 'os-row';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = name.length > 0 ? name : number;
      nameRow.append(nameSpan);
      const timeRow = document.createElement('div');
      timeRow.className = 'os-row';
      timeText = document.createElement('span');
      timeText.className = 'os-val';
      timeText.textContent = '00:00';
      timeRow.append(timeText);
      list.append(nameRow, timeRow);
      const soft = document.createElement('div');
      soft.className = 'os-soft';
      const hint = document.createElement('span');
      hint.className = 'os-hint';
      hint.textContent = 'any key ends';
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'os-back';
      back.textContent = 'Back';
      soft.append(hint, back);
      root.append(title, list, soft);
      playTone(440, 300);
      timerId = window.setInterval(() => {
        if (timeText !== null) timeText.textContent = elapsedText();
      }, 1000);
    },
    unmount(): void {
      stopTimer();
      if (root !== null) root.textContent = '';
      root = null;
      timeText = null;
    },
    onKey(_event: OsKeyEvent): void {
      endCall();
    },
  };
}
