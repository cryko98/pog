import { randomScarf } from './colors';

/**
 * A guest penguin: you can waddle, chat and explore without a wallet.
 *
 * Guests exist only in this browser — there is no server record, so nothing
 * they do can be credited. That is deliberate: $POG is awarded against a
 * wallet address, and a guest has none to award it to.
 */
export interface Guest {
  id: string;
  name: string;
  color: string;
}

const GUEST_KEY = 'pog.guest';

const randomId = () =>
  'guest-' + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Guest names always end in digits, so they read as throwaway at a glance. */
const randomName = () => 'Guest' + String(Math.floor(Math.random() * 9000) + 1000);

export function loadGuest(): Guest | null {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    if (!raw) return null;
    const g = JSON.parse(raw);
    if (typeof g?.id === 'string' && typeof g?.name === 'string') return g as Guest;
  } catch {
    /* corrupt entry — start fresh */
  }
  return null;
}

export function createGuest(): Guest {
  const guest: Guest = { id: randomId(), name: randomName(), color: randomScarf() };
  saveGuest(guest);
  return guest;
}

export function saveGuest(guest: Guest) {
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify(guest));
  } catch {
    /* private mode — the guest just will not persist */
  }
}

export function clearGuest() {
  localStorage.removeItem(GUEST_KEY);
}
