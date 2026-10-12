export type OsKeyName =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'select'
  | 'back'
  | 'clear'
  | 'digit'
  | 'star'
  | 'hash';

export interface OsKeyEvent {
  name: OsKeyName;
  digit?: number;
}

export interface OsApp {
  id: string;
  title: string;
  mount(root: HTMLElement): void;
  unmount(): void;
  onKey(event: OsKeyEvent): void;
}

export interface Contact {
  name: string;
  number: string;
}

export interface OsServices {
  contacts(): Contact[];
  saveContacts(list: Contact[]): void;
  playTone(freq: number, ms: number): void;
  ringtoneNotes(): string;
  saveRingtone(notes: string): void;
}
