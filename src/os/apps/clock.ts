import type { OsApp, OsKeyEvent, OsServices } from '../types';
import { emitPhoneEvent, PhoneEvent } from '../events';

const STORAGE_KEY = 'snake2_alarm';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function readStoredAlarm(): string | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    if (!/^\d{2}:\d{2}$/.test(raw)) return null;
    const hh = Number(raw.slice(0, 2));
    const mm = Number(raw.slice(3, 5));
    if (hh > 23 || mm > 59) return null;
    return raw;
  } catch {
    return null;
  }
}

function isValidBuffer(buffer: string): boolean {
  if (!/^\d{4}$/.test(buffer)) return false;
  const hh = Number(buffer.slice(0, 2));
  const mm = Number(buffer.slice(2, 4));
  return hh <= 23 && mm <= 59;
}

export function createClockApp(services: OsServices): OsApp {
  let root: HTMLElement | null = null;
  let tickId = 0;
  let ringId = 0;
  let ringingUntil = 0;
  let firedSignature = '';
  let alarm: string | null = readStoredAlarm();
  let cursor = 0;
  let editing = false;
  let buffer = '';
  let timeText: HTMLElement | null = null;
  let editInput: HTMLInputElement | null = null;
  let hintText: HTMLElement | null = null;

  function nowParts(): { hh: string; mm: string; day: string } {
    const d = new Date();
    return {
      hh: pad2(d.getHours()),
      mm: pad2(d.getMinutes()),
      day: String(d.getFullYear()) + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()),
    };
  }

  function stopRinging(): void {
    ringingUntil = 0;
    if (ringId !== 0) {
      window.clearInterval(ringId);
      ringId = 0;
    }
    if (hintText !== null) hintText.textContent = '';
  }

  function startRinging(): void {
    ringingUntil = Date.now() + 30000;
    services.playTone(1000, 400);
    if (hintText !== null) hintText.textContent = 'Alarm! Press any key';
    ringId = window.setInterval(() => {
      if (Date.now() >= ringingUntil) {
        stopRinging();
        return;
      }
      services.playTone(1000, 400);
    }, 2000);
  }

  function renderList(): void {
    if (root === null) return;
    root.textContent = '';
    const title = document.createElement('div');
    title.className = 'os-title';
    title.textContent = 'Clock';
    const list = document.createElement('div');
    list.className = 'os-list';

    const timeRow = document.createElement('div');
    timeRow.className = 'os-row' + (cursor === 0 && !editing ? ' os-cur' : '');
    const timeLabel = document.createElement('span');
    timeLabel.textContent = 'Time';
    timeText = document.createElement('span');
    timeText.style.fontSize = '28px';
    const now = nowParts();
    timeText.textContent = now.hh + ':' + now.mm;
    timeRow.append(timeLabel, timeText);

    const alarmRow = document.createElement('div');
    alarmRow.className = 'os-row' + (cursor === 1 || editing ? ' os-cur' : '');
    const alarmLabel = document.createElement('span');
    alarmLabel.textContent = 'Alarm';
    if (editing) {
      editInput = document.createElement('input');
      editInput.className = 'os-input';
      editInput.inputMode = 'numeric';
      editInput.maxLength = 4;
      editInput.value = buffer;
      editInput.addEventListener('input', () => {
        if (editInput !== null) buffer = editInput.value.replace(/\D/g, '').slice(0, 4);
      });
      alarmRow.append(alarmLabel, editInput);
    } else {
      const alarmValue = document.createElement('span');
      alarmValue.className = 'os-val';
      alarmValue.textContent = alarm !== null ? alarm : 'Off';
      alarmRow.append(alarmLabel, alarmValue);
      editInput = null;
    }
    list.append(timeRow, alarmRow);

    hintText = document.createElement('div');
    hintText.className = 'os-hint';
    hintText.textContent = editing ? 'Type HHMM, 5 save' : '';

    const soft = document.createElement('div');
    soft.className = 'os-soft';
    const hint = document.createElement('span');
    hint.textContent = '';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'os-back';
    back.textContent = 'Back';
    soft.append(hint, back);

    root.append(title, list, hintText, soft);
    if (editing && editInput !== null) editInput.focus();
  }

  function commitEdit(): void {
    let next: string | null;
    if (buffer === '' || buffer === '0' || buffer === '0000') {
      next = null;
    } else if (isValidBuffer(buffer)) {
      next = buffer.slice(0, 2) + ':' + buffer.slice(2, 4);
    } else {
      if (hintText !== null) hintText.textContent = 'Bad time';
      return;
    }
    alarm = next;
    try {
      if (next === null) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      return;
    }
    editing = false;
    buffer = '';
    renderList();
  }

  function tick(): void {
    const now = nowParts();
    if (timeText !== null) timeText.textContent = now.hh + ':' + now.mm;
    if (
      alarm !== null &&
      ringingUntil === 0 &&
      alarm === now.hh + ':' + now.mm &&
      firedSignature !== now.day + ' ' + alarm
    ) {
      firedSignature = now.day + ' ' + alarm;
      startRinging();
    }
  }

  return {
    id: 'clock',
    acceptsDigits: () => true,
    title: 'Clock',
    mount(target: HTMLElement): void {
      root = target;
      root.className = 'os-screen';
      alarm = readStoredAlarm();
      renderList();
      tick();
      tickId = window.setInterval(tick, 1000);
    },
    unmount(): void {
      if (tickId !== 0) {
        window.clearInterval(tickId);
        tickId = 0;
      }
      stopRinging();
      if (root !== null) root.textContent = '';
      root = null;
      timeText = null;
      editInput = null;
      hintText = null;
    },
    onKey(event: OsKeyEvent): void {
      if (ringingUntil !== 0) {
        stopRinging();
        return;
      }
      if (editing) {
        if (event.name === 'digit' && event.digit !== undefined) {
          if (buffer.length < 4) buffer += String(event.digit);
          if (editInput !== null) editInput.value = buffer;
        } else if (event.name === 'select') {
          commitEdit();
        } else if (event.name === 'back') {
          editing = false;
          buffer = '';
          renderList();
        } else if (event.name === 'clear') {
          buffer = '';
          if (editInput !== null) editInput.value = buffer;
        }
        return;
      }
      if (event.name === 'back') {
        emitPhoneEvent(PhoneEvent.home);
      } else if (event.name === 'up' || event.name === 'down') {
        cursor =
          event.name === 'up' ? Math.max(0, cursor - 1) : Math.min(1, cursor + 1);
        renderList();
      } else if (event.name === 'select') {
        if (cursor === 1) {
          editing = true;
          buffer = alarm !== null ? alarm.slice(0, 2) + alarm.slice(3, 5) : '';
          renderList();
        }
      }
    },
  };
}
