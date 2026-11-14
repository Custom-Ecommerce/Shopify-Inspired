import { createHmac, timingSafeEqual } from 'node:crypto';

/*
 * The order-access token: what lets the tab that placed an order read it back without a phone number. It proves "this server
 * gave you this order of this store", for 24 hours from the order. The value is <expiry in ms>.<HMAC-SHA256 in hex>.
 */

const LIFETIME_MS = 24 * 60 * 60 * 1000;
const MIN_SECRET_LENGTH = 32;
const TOKEN = /^(\d{1,16})\.([0-9a-f]{64})$/;

const usableSecret = (): string | null => {
  const secret = process.env.ORDER_ACCESS_SECRET ?? '';
  return secret.length >= MIN_SECRET_LENGTH ? secret : null;
};

const signature = (secret: string, orderNumber: string, storeId: string, expires: string): Buffer =>
  createHmac('sha256', secret).update([orderNumber, storeId, expires].join('\n'), 'utf8').digest();

/** Counted from when the order was made, so a replay of the placement cannot extend it. Null when no secret is configured. */
export function issueOrderAccessToken(orderNumber: string, storeId: string, placedAt: Date | string | null | undefined, now: number = Date.now()): string | null {
  const secret = usableSecret();
  if (secret === null) return null;
  const expires = String((placedAt ? new Date(placedAt).getTime() : now) + LIFETIME_MS);
  return expires + '.' + signature(secret, orderNumber, storeId, expires).toString('hex');
}

/** True only for an unexpired token this server made for exactly this order of this store. Never throws. */
export function isValidOrderAccessToken(token: string, orderNumber: string, storeId: string, now: number = Date.now()): boolean {
  const secret = usableSecret();
  const parts = TOKEN.exec(token);
  if (secret === null || parts === null) return false;
  const [, expires = '', provided = ''] = parts;
  if (Number(expires) <= now) return false;
  return timingSafeEqual(signature(secret, orderNumber, storeId, expires), Buffer.from(provided, 'hex'));
}
