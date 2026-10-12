import type { OsApp, OsKeyEvent } from '../types';
import { emitPhoneEvent, PhoneEvent } from '../events';

interface Reminder {
  text: string;
  at: number;
}

const STORAGE_KEY = 'snake2_reminders';

function isReminder(value: unknown): value is Reminder {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.text === 'string' && typeof item.at === 'number';
}

function readReminders(): Reminder[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isReminder);
  } catch {
    return [];
  }
}

function writeReminders(list: Reminder[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    return;
  }
}

function sortedReminders(): Reminder[] {
  const now = Date.now();
  return [...readReminders()].sort((a, b) => {
    const rankA = a.at <= now ? 0 : 1;
    const rankB = b.at <= now ? 0 : 1;
    if (rankA !== rankB) return rankA - rankB;
    return a.at - b.at;
  });
}

type View = 'list' | 'form' | 'confirm';

export function createRemindersApp(): OsApp {
  let root: HTMLElement | null = null;
  let view: View = 'list';
  let cursor = 0;
  let list: Reminder[] = [];
  let input: HTMLInputElement | null = null;
  let formCursor = 0;
  let hintText: HTMLElement | null = null;
  let formRows: HTMLElement[] = [];

  function renderShell(): void {
    if (root !== null) root.textContent = '';
    const title = document.createElement('div');
    title.className = 'os-title';
    title.textContent = 'Reminders';
    root?.append(title);
  }

  function makeSoft(): HTMLElement {
    const soft = document.createElement('div');
    soft.className = 'os-soft';
    const hint = document.createElement('span');
    hint.className = 'os-hint';
    hint.textContent = view === 'list' ? '# add  C delete' : '';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'os-back';
    back.textContent = 'Back';
    soft.append(hint, back);
    return soft;
  }

  function renderList(): void {
    view = 'list';
    input = null;
    formRows = [];
    list = sortedReminders();
    if (cursor >= list.length) cursor = Math.max(0, list.length - 1);
    renderShell();
    const container = document.createElement('div');
    container.className = 'os-list';
    if (list.length === 0) {
      const row = document.createElement('div');
      row.className = 'os-row';
      const span = document.createElement('span');
      span.textContent = 'No reminders';
      row.append(span);
      container.append(row);
    } else {
      const now = Date.now();
      list.forEach((reminder, i) => {
        const row = document.createElement('div');
        row.className = 'os-row' + (i === cursor ? ' os-cur' : '');
        const span = document.createElement('span');
        span.textContent = (reminder.at <= now ? '! ' : '') + reminder.text;
        row.append(span);
        container.append(row);
      });
    }
    hintText = document.createElement('div');
    hintText.className = 'os-hint';
    hintText.textContent = list.length === 0 ? 'Press # to add' : '';
    root?.append(container, hintText, makeSoft());
  }

  function renderForm(): void {
    view = 'form';
    formCursor = 0;
    renderShell();
    const container = document.createElement('div');
    container.className = 'os-list';
    formRows = [];
    const inputRow = document.createElement('div');
    inputRow.className = 'os-row';
    input = document.createElement('input');
    input.className = 'os-input';
    input.maxLength = 40;
    input.placeholder = 'reminder';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    inputRow.append(input);
    formRows.push(inputRow);
    container.append(inputRow);
    const saveRow = document.createElement('div');
    saveRow.className = 'os-row';
    const saveLabel = document.createElement('span');
    saveLabel.textContent = 'Save';
    saveRow.append(saveLabel);
    formRows.push(saveRow);
    container.append(saveRow);
    hintText = document.createElement('div');
    hintText.className = 'os-hint';
    hintText.textContent = '';
    root?.append(container, hintText, makeSoft());
    updateFormCursor();
    input.focus();
  }

  function updateFormCursor(): void {
    formRows.forEach((row, i) => {
      if (i === formCursor) row.classList.add('os-cur');
      else row.classList.remove('os-cur');
    });
    if (formCursor === 0 && input !== null) input.focus();
  }

  function renderConfirm(): void {
    view = 'confirm';
    renderShell();
    const container = document.createElement('div');
    container.className = 'os-list';
    const row = document.createElement('div');
    row.className = 'os-row os-cur';
    const span = document.createElement('span');
    span.textContent = 'Delete? 5 yes C no';
    row.append(span);
    container.append(row);
    root?.append(container, makeSoft());
  }

  function saveForm(): void {
    const text = input !== null ? input.value.trim() : '';
    if (text.length === 0) {
      if (hintText !== null) hintText.textContent = 'Text required';
      return;
    }
    const all = readReminders();
    all.push({ text, at: Date.now() + 3600000 });
    writeReminders(all);
    renderList();
  }

  function deleteCurrent(): void {
    const target = list[cursor];
    if (target === undefined) return;
    writeReminders(
      readReminders().filter((r) => !(r.text === target.text && r.at === target.at))
    );
    renderList();
  }

  return {
    id: 'reminders',
    acceptsDigits: () => view === 'form',
    title: 'Reminders',
    mount(target: HTMLElement): void {
      root = target;
      root.className = 'os-screen';
      cursor = 0;
      renderList();
    },
    unmount(): void {
      if (root !== null) root.textContent = '';
      root = null;
      input = null;
      hintText = null;
      formRows = [];
    },
    onKey(event: OsKeyEvent): void {
      if (view === 'list') {
        if (event.name === 'back') {
          emitPhoneEvent(PhoneEvent.home);
        } else if (event.name === 'up' || event.name === 'down') {
          if (list.length === 0) return;
          cursor =
            event.name === 'up'
              ? Math.max(0, cursor - 1)
              : Math.min(list.length - 1, cursor + 1);
          renderList();
        } else if (event.name === 'star' || event.name === 'hash') {
          renderForm();
        } else if (event.name === 'clear') {
          if (list.length > 0) renderConfirm();
        }
      } else if (view === 'form') {
        if (event.name === 'up' || event.name === 'down') {
          formCursor =
            event.name === 'up' ? Math.max(0, formCursor - 1) : Math.min(1, formCursor + 1);
          updateFormCursor();
        } else if (event.name === 'select') {
          if (formCursor === 1) saveForm();
          else updateFormCursor();
        } else if (event.name === 'back') {
          renderList();
        } else if (event.name === 'digit' && event.digit !== undefined && formCursor === 0) {
          if (input !== null && input.value.length < 40) input.value += String(event.digit);
        } else if (event.name === 'clear' && formCursor === 0) {
          if (input !== null) input.value = input.value.slice(0, -1);
        }
      } else if (view === 'confirm') {
        if (event.name === 'select' || (event.name === 'digit' && event.digit === 5)) {
          deleteCurrent();
        } else if (event.name === 'back') {
          renderList();
        }
      }
    },
  };
}
