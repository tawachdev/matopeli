import type { OsApp, OsKeyEvent, OsServices } from '../types';
import { emitPhoneEvent, PhoneEvent } from '../events';

type Note = { kind: 'note'; letter: number; shift: number };
type Rest = { kind: 'rest' };
type SeqToken = Note | Rest;

const BASE_FREQ = 261.63;
const NATURAL_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
const NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
const NOTE_MS = 180;

function totalOffset(token: SeqToken): number | null {
  if (token.kind === 'rest') return null;
  return NATURAL_SEMITONES[token.letter] + token.shift;
}

function tokenFreq(token: SeqToken): number {
  const offset = totalOffset(token);
  if (offset === null) return 0;
  return BASE_FREQ * Math.pow(2, offset / 12);
}

function tokenLabel(token: SeqToken): string {
  if (token.kind === 'rest') return '-';
  const t = NATURAL_SEMITONES[token.letter] + token.shift;
  const name = NAMES[((t % 12) + 12) % 12];
  const octave = 4 + Math.floor(t / 12);
  return name + String(octave);
}

function parseToken(raw: string): SeqToken | null {
  if (raw === '-') return { kind: 'rest' };
  const match = /^([a-g]#?)(\d)$/.exec(raw);
  if (match === null) return null;
  const semi = NAMES.indexOf(match[1]);
  const octave = Number(match[2]);
  if (semi < 0 || !Number.isInteger(octave)) return null;
  const t = (octave - 4) * 12 + semi;
  let letter = 0;
  for (let i = NATURAL_SEMITONES.length - 1; i >= 0; i--) {
    if (NATURAL_SEMITONES[i] <= t) {
      letter = i;
      break;
    }
  }
  const shift = Math.max(-12, Math.min(12, t - NATURAL_SEMITONES[letter]));
  return { kind: 'note', letter, shift };
}

function parseSequence(raw: string): SeqToken[] {
  const tokens: SeqToken[] = [];
  for (const part of raw.split(/\s+/)) {
    if (part.length === 0) continue;
    const token = parseToken(part);
    if (token !== null) tokens.push(token);
  }
  return tokens;
}

export function createComposerApp(services: OsServices): OsApp {
  let root: HTMLElement | null = null;
  let tokens: SeqToken[] = [];
  let cursor = 0;
  let seqLine: HTMLElement | null = null;
  let playTimers: number[] = [];

  function sequenceString(): string {
    return tokens.map(tokenLabel).join(' ');
  }

  function stopPlayback(): void {
    for (const id of playTimers) window.clearTimeout(id);
    playTimers = [];
  }

  function play(): void {
    stopPlayback();
    tokens.forEach((token, i) => {
      const id = window.setTimeout(() => {
        services.playTone(tokenFreq(token), NOTE_MS);
      }, i * NOTE_MS);
      playTimers.push(id);
    });
  }

  function renderSequence(): void {
    if (seqLine === null) return;
    const parts = tokens.map(tokenLabel);
    parts.push('_');
    const shown = parts
      .map((part, i) => (i === cursor ? '[' + part + ']' : part))
      .join(' ');
    seqLine.textContent = shown;
  }

  function effectiveIndex(): number {
    return cursor < tokens.length ? cursor : tokens.length - 1;
  }

  return {
    id: 'composer',
    acceptsDigits: () => true,
    title: 'Composer',
    mount(target: HTMLElement): void {
      root = target;
      root.className = 'os-screen';
      try {
        tokens = parseSequence(services.ringtoneNotes());
      } catch {
        tokens = [];
      }
      cursor = tokens.length;
      const title = document.createElement('div');
      title.className = 'os-title';
      title.textContent = 'Composer';
      const list = document.createElement('div');
      list.className = 'os-list';
      const row = document.createElement('div');
      row.className = 'os-row';
      seqLine = document.createElement('span');
      seqLine.style.fontFamily = 'monospace';
      row.append(seqLine);
      list.append(row);
      const hint = document.createElement('div');
      hint.className = 'os-hint';
      hint.textContent = '1-7 note * rest 5 play';
      const soft = document.createElement('div');
      soft.className = 'os-soft';
      const softHint = document.createElement('span');
      softHint.textContent = '';
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'os-back';
      back.textContent = 'Back';
      soft.append(softHint, back);
      root.append(title, list, hint, soft);
      renderSequence();
    },
    unmount(): void {
      stopPlayback();
      services.saveRingtone(sequenceString());
      if (root !== null) root.textContent = '';
      root = null;
      seqLine = null;
    },
    onKey(event: OsKeyEvent): void {
      if (event.name === 'digit' && event.digit !== undefined && event.digit >= 1 && event.digit <= 7) {
        tokens.splice(cursor, 0, { kind: 'note', letter: event.digit - 1, shift: 0 });
        cursor++;
      } else if (event.name === 'star') {
        tokens.splice(cursor, 0, { kind: 'rest' });
        cursor++;
      } else if (event.name === 'up' || event.name === 'down') {
        const index = effectiveIndex();
        if (index >= 0) {
          const token = tokens[index];
          if (token.kind === 'note') {
            if (event.name === 'up') token.shift = Math.min(12, token.shift + 1);
            else token.shift = Math.max(-12, token.shift - 1);
          }
        }
      } else if (event.name === 'left') {
        cursor = Math.max(0, cursor - 1);
      } else if (event.name === 'right') {
        cursor = Math.min(tokens.length, cursor + 1);
      } else if (event.name === 'select') {
        play();
      } else if (event.name === 'back') {
        if (tokens.length === 0) {
          emitPhoneEvent(PhoneEvent.home);
          return;
        }
        const index = effectiveIndex();
        if (index >= 0) {
          tokens.splice(index, 1);
          cursor = Math.min(cursor, tokens.length);
        }
      } else if (event.name === 'clear') {
        tokens = [];
        cursor = 0;
      }
      renderSequence();
    },
  };
}
