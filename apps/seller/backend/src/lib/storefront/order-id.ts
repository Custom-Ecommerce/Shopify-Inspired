import { randomInt } from 'node:crypto';

// No 0/O or 1/I/L: an order id is read aloud and typed from a phone screen.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 8;

/** A human-facing order id such as ORD-7KQ4M2XA. 31^8 values, drawn from a CSPRNG, so ids cannot be guessed in sequence. */
export function generateOrderId(): string {
  let out = '';
  for (let i = 0; i < LENGTH; i += 1) out += ALPHABET.charAt(randomInt(ALPHABET.length));
  return 'ORD-' + out;
}

/** Lookup input is typed by hand: trim, uppercase, and add the prefix if the shopper left it off. */
export function normalizeOrderId(raw: string): string {
  const value = raw.trim().toUpperCase().replace(/\s+/g, '');
  return value.startsWith('ORD-') ? value : 'ORD-' + value;
}
