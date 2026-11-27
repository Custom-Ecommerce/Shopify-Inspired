export { createPhonePush, type PushAvailability, type PushPort, type PushRegistration } from '@markaz/mobile-kit';

/* Which screen of the seller app a notification opens. The push library itself is wrapped in @markaz/mobile-kit. */

export interface PushTarget {
  /** The app's route. */
  path: string;
  /** The store to switch to first, when the push names one. */
  storeId: string | null;
}

const ID = /^[0-9a-fA-F]{24}$/;
const idOf = (value: unknown): string | null => (typeof value === 'string' && ID.test(value) ? value : null);

/** Only the screens named in docs/mobile-api-v1.md; anything else (and any odd id) opens nothing. */
export function routeForPush(data: unknown): PushTarget | null {
  const record = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const storeId = idOf(record.storeId);
  if (record.screen === 'order') {
    const orderId = idOf(record.orderId);
    return orderId && storeId ? { path: `/orders/${orderId}`, storeId } : null;
  }
  if (record.screen === 'inventory') return storeId ? { path: '/products?stock=low', storeId } : null;
  if (record.screen === 'billing' || record.screen === 'ticket') return { path: '/', storeId: null };
  return null;
}

