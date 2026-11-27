/* Which screen of the admin app a notification opens (docs/mobile-api-v1.md). The push library itself is wrapped in @markaz/mobile-kit. */

const ID = /^[0-9a-fA-F]{24}$/;
const idOf = (value: unknown): string | null => (typeof value === 'string' && ID.test(value) ? value : null);

/** Only the screens the API names; anything else, and any odd id, opens nothing. */
export function routeForAdminPush(data: unknown): string | null {
  const record = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  if (record.screen === 'ticket') {
    const id = idOf(record.ticketId);
    return id ? `/tickets/${id}` : null;
  }
  if (record.screen === 'payment') {
    const id = idOf(record.paymentId);
    return id ? `/payments/${id}` : null;
  }
  if (record.screen === 'sync') return '/sync';
  return null;
}
