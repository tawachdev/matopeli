const RINGTONE_KEY = 'snake2_ringtone';

let ctx: AudioContext | null = null;

function audioCtx(): AudioContext | null {
  try {
    ctx = ctx || new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export function playTone(freq: number, ms: number): void {
  if (freq <= 0) return;
  const context = audioCtx();
  if (!context) return;
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = 'square';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.05, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + ms / 1000);
  osc.connect(gain);
  gain.connect(context.destination);
  osc.start();
  osc.stop(context.currentTime + ms / 1000);
}

const NOTE_SEMITONES: Record<string, number> = {
  c: 0,
  d: 2,
  e: 4,
  f: 5,
  g: 7,
  a: 9,
  b: 11,
};

export function noteFreq(note: string): number {
  const match = /^([a-g])(#?)(-?\d)$/.exec(note);
  if (!match) return 0;
  const semitone = (NOTE_SEMITONES[match[1]] ?? 0) + (match[2] ? 1 : 0);
  const octave = Number(match[3]);
  return 261.63 * Math.pow(2, semitone / 12 + (octave - 4));
}

export function playSequence(notes: string, noteMs = 180): void {
  notes
    .split(/\s+/)
    .filter(Boolean)
    .forEach((token, index) => {
      if (token === '-') return;
      setTimeout(() => playTone(noteFreq(token), noteMs), index * noteMs);
    });
}

export function currentRingtone(): string {
  try {
    return localStorage.getItem(RINGTONE_KEY) || 'e4 d4 f4 g4';
  } catch {
    return 'e4 d4 f4 g4';
  }
}

export function saveRingtone(notes: string): void {
  try {
    localStorage.setItem(RINGTONE_KEY, notes);
  } catch {}
}

export function incomingAlert(kind: string): void {
  if (vibrateWanted() && navigator.vibrate) {
    try {
      navigator.vibrate(90);
    } catch {}
  }
  if (kind === 'ringtone') {
    playSequence(currentRingtone());
    return;
  }
  const alert = messageAlertSetting();
  if (alert === 'Silent') return;
  if (alert === 'Beep once') playSequence('a5');
  else if (alert === 'Beep twice') playSequence('a5 - a5');
  else playSequence('a5 c6 a5 c6 a5 c6', 140);
}

function messageAlertSetting(): string {
  try {
    return localStorage.getItem('snake2_msg_alert') || 'Fancy';
  } catch {
    return 'Fancy';
  }
}

function vibrateWanted(): boolean {
  try {
    return localStorage.getItem('snake2_vibrate_alert') !== '0';
  } catch {
    return true;
  }
}
