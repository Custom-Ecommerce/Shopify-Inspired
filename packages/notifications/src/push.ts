/*
 * Sprint 9 (EP-31.US02): push messages to the phone apps. The port (PushClient), the Expo implementation, and the events: who gets which, what it says, the
 * per-user mute, the daily quota and the one-push-per-event rule. A push goes through the notification outbox like an email (channel 'push'), so it is
 * retried the same way; see outbox.ts.
 *
 * D-118: a push carries a title and one short line built here from an order number, an amount or a count. No name, phone, address, email or free text of
 * anybody ever goes into one. No function here logs a push token.
 */

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  /** Which screen to open: ids only. */
  data: Record<string, string>;
}

export type PushSendResult =
  | { ok: true; ticketId?: string | null }
  /** deadToken: the push service says this token is gone. It is removed and the message is not tried again. */
  | { ok: false; error: string; retryable: boolean; deadToken?: boolean };

export interface PushClient {
  readonly name: string;
  send(message: PushMessage): Promise<PushSendResult>;
}

/** What the outbox needs to send a push row. */
export interface PushChannel {
  client: PushClient;
  onDeadToken(token: string): Promise<void>;
}

const EXPO_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_\-:.]{10,200}\]$/;

export const isExpoPushToken = (value: unknown): value is string => typeof value === 'string' && value.length <= 254 && EXPO_TOKEN.test(value);

/** Removes anything that looks like a push token from an error text. */
export const redactPushTokens = (text: string): string => text.replace(/Expo(nent)?PushToken\[[^\]]*\]?/g, '[push token]');

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type FetchLike = (url: string, init: Record<string, unknown>) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** The Expo Push API. The access token is optional (Expo's "enhanced security" setting); it is never logged. */
export function createExpoPushClient(options: { accessToken?: string | null; fetchImpl?: FetchLike; timeoutMs?: number } = {}): PushClient {
  return {
    name: 'expo',
    async send(message) {
      const run = options.fetchImpl ?? (fetch as unknown as FetchLike);
      const accessToken = (options.accessToken ?? '').trim();
      try {
        const response = await run(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json', ...(accessToken ? { authorization: 'Bearer ' + accessToken } : {}) },
          body: JSON.stringify({ to: message.to, title: message.title, body: message.body, data: message.data, sound: 'default' }),
          signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        });
        if (!response.ok) return { ok: false, error: 'EXPO_HTTP_' + response.status, retryable: response.status === 429 || response.status >= 500 };
        const answer = (await response.json()) as { data?: unknown; errors?: Array<{ code?: unknown }> };
        const ticket = (Array.isArray(answer?.data) ? answer.data[0] : answer?.data) as { status?: unknown; id?: unknown; details?: { error?: unknown } } | undefined;
        if (!ticket) return { ok: false, error: 'EXPO_' + String(answer?.errors?.[0]?.code ?? 'NO_TICKET'), retryable: true };
        if (ticket.status === 'ok') return { ok: true, ticketId: typeof ticket.id === 'string' ? ticket.id : null };
        const code = String(ticket.details?.error ?? 'UNKNOWN').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);
        return { ok: false, error: 'EXPO_' + code, retryable: code === 'MessageRateExceeded', ...(code === 'DeviceNotRegistered' ? { deadToken: true } : {}) };
      } catch (err) {
        return { ok: false, error: redactPushTokens(err instanceof Error ? err.name + ': ' + err.message : 'network error').slice(0, 200), retryable: true };
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Events and who gets them

export type PushApp = 'seller' | 'admin';

export const SELLER_PUSH_KINDS = ['order_new', 'order_cancelled', 'low_stock', 'subscription_payment', 'support_reply'] as const;
export const ADMIN_PUSH_KINDS = ['payment_claim', 'ticket_new', 'sync_failure'] as const;
export type PushKind = (typeof SELLER_PUSH_KINDS)[number] | (typeof ADMIN_PUSH_KINDS)[number];

/**
 * The role table: who gets which push. Seller side the roles of the STORE (support answers tickets only; subscription money is the owner's); admin side the
 * admin levels (the same holders as payments.read, tickets.read and sync.read of the admin capability matrix).
 */
export const PUSH_ROLE_TABLE: Readonly<Record<PushKind, readonly string[]>> = Object.freeze({
  order_new: ['owner', 'manager', 'staff'],
  order_cancelled: ['owner', 'manager', 'staff'],
  low_stock: ['owner', 'manager', 'staff'],
  subscription_payment: ['owner'],
  support_reply: ['owner', 'manager', 'staff', 'support'],
  payment_claim: ['owner', 'finance'],
  ticket_new: ['owner', 'customer_support'],
  sync_failure: ['owner', 'operations'],
});

/** The most pushes one user gets in one UTC day, whatever the number of their phones. */
export const PUSH_DAILY_QUOTA = 50;

export interface PushContent {
  title: string;
  body: string;
  data: Record<string, string>;
}

const rupees = (amount: number): string => 'Rs. ' + Math.max(0, Math.round(Number(amount) || 0)).toLocaleString('en-US');
/** An order number is letters, digits and dashes; anything else is left out rather than shown. */
const orderLabel = (orderNumber: string): string => (/^[A-Za-z0-9-]{1,32}$/.test(orderNumber) ? 'Order ' + orderNumber : 'An order');
const id = (value: string): string => (/^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : '');

export const pushContent = {
  orderNew: (o: { storeId: string; orderId: string; orderNumber: string; total: number }): PushContent => ({
    title: 'New order',
    body: orderLabel(o.orderNumber) + ' - ' + rupees(o.total),
    data: { screen: 'order', storeId: id(o.storeId), orderId: id(o.orderId) },
  }),
  orderCancelled: (o: { storeId: string; orderId: string; orderNumber: string; total: number }): PushContent => ({
    title: 'Order cancelled',
    body: orderLabel(o.orderNumber) + ' - ' + rupees(o.total),
    data: { screen: 'order', storeId: id(o.storeId), orderId: id(o.orderId) },
  }),
  lowStock: (s: { storeId: string; quantity: number }): PushContent => ({
    title: s.quantity <= 0 ? 'Out of stock' : 'Low stock',
    body: s.quantity <= 0 ? 'A product is out of stock.' : 'A product has ' + Math.round(s.quantity) + ' left.',
    data: { screen: 'inventory', storeId: id(s.storeId) },
  }),
  subscriptionPayment: (p: { confirmed: boolean; amount: number }): PushContent => ({
    title: p.confirmed ? 'Payment confirmed' : 'Payment not accepted',
    body: 'Subscription payment of ' + rupees(p.amount),
    data: { screen: 'billing' },
  }),
  supportReply: (t: { ticketId: string }): PushContent => ({ title: 'Support replied', body: 'There is a new reply on your ticket.', data: { screen: 'ticket', ticketId: id(t.ticketId) } }),
  paymentClaim: (p: { paymentId: string; amount: number }): PushContent => ({
    title: 'Payment to check',
    body: 'A subscription payment of ' + rupees(p.amount) + ' was claimed.',
    data: { screen: 'payment', paymentId: id(p.paymentId) },
  }),
  ticketNew: (t: { ticketId: string }): PushContent => ({ title: 'New ticket', body: 'A seller opened a support ticket.', data: { screen: 'ticket', ticketId: id(t.ticketId) } }),
  syncFailure: (s: { count: number }): PushContent => ({ title: 'Sync failed', body: Math.round(s.count) + ' sync events could not be delivered.', data: { screen: 'sync' } }),
};

export interface PushPrefs {
  muted: boolean;
  mutedKinds: string[];
  /** Pakistan time, HH:MM. */
  quietHours?: { start: string; end: string };
}

/** A stored preference read leniently: missing means everything is on. */
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

export function readPushPrefs(value: unknown): PushPrefs {
  const row = (value ?? {}) as { muted?: unknown; mutedKinds?: unknown; quietHours?: { start?: unknown; end?: unknown } | null };
  const prefs: PushPrefs = { muted: row.muted === true, mutedKinds: Array.isArray(row.mutedKinds) ? row.mutedKinds.filter((k): k is string => typeof k === 'string') : [] };
  const { start, end } = row.quietHours ?? {};
  // Left out when there are none, so the answer keeps the shape it had.
  if (typeof start === 'string' && typeof end === 'string' && CLOCK.test(start) && CLOCK.test(end) && start !== end) prefs.quietHours = { start, end };
  return prefs;
}

/** Pakistan Standard Time has no daylight saving: always UTC+05:00. */
const PAKISTAN_OFFSET_MINUTES = 5 * 60;
const minutesOf = (clock: string): number => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

/** Whether `now` is inside the user's quiet hours (Pakistan time). The start minute is quiet, the end minute is not; the hours may cross midnight. */
export function isQuietTime(prefs: PushPrefs, now: Date): boolean {
  if (!prefs.quietHours) return false;
  const minute = (now.getUTCHours() * 60 + now.getUTCMinutes() + PAKISTAN_OFFSET_MINUTES) % (24 * 60);
  const start = minutesOf(prefs.quietHours.start);
  const end = minutesOf(prefs.quietHours.end);
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}
