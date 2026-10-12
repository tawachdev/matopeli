import type { Contact } from './types';

export const PhoneEvent = {
  home: 'phone:home',
  menuOpened: 'phone:menu-opened',
  gameExit: 'phone:game-exit',
  settingsRequested: 'phone:settings-requested',
} as const;

export type PhoneEventName = (typeof PhoneEvent)[keyof typeof PhoneEvent];

const CALL_REQUESTED = 'phone:call-requested';

export function emitPhoneEvent(name: PhoneEventName): void {
  window.dispatchEvent(new Event(name));
}

export function onPhoneEvent(name: PhoneEventName, listener: () => void): void {
  window.addEventListener(name, listener);
}

export function requestCall(contact: Contact): void {
  window.dispatchEvent(new CustomEvent<Contact>(CALL_REQUESTED, { detail: { name: contact.name, number: contact.number } }));
}

function isContact(value: unknown): value is Contact {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.name === 'string' && typeof candidate.number === 'string';
}

export function onCallRequested(listener: (contact: Contact) => void): void {
  window.addEventListener(CALL_REQUESTED, (event) => {
    const detail: unknown = event instanceof CustomEvent ? event.detail : undefined;
    if (isContact(detail)) listener(detail);
  });
}
