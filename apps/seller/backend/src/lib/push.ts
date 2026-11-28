import mongoose from 'mongoose';
import * as notificationsNs from '@markaz/notifications';
import type { NotificationOutboxModel, PushChannel, PushClient, PushDeps, PushEventResult, PushKind } from '@markaz/notifications';
import { unwrapCjs } from '@/lib/cjs';
import {
  MobileDevice,
  mongoMobileDeviceStore,
  mongoRateCounterStore,
  NotificationOutbox,
  RateLimitCounter,
  Store,
  StoreMember,
  User,
} from '@/lib/services';
import type { MobileDeviceModelPort } from '@markaz/auth';

const notifications: typeof notificationsNs = unwrapCjs(notificationsNs);

/**
 * Sprint 9 (EP-31.US02): the seller backend's push events. The seller's own phones are told about their stores; the admin phones are told about the two
 * things that happen here (a payment claim, a new ticket). The rules (who, what it says, mute, quota, once per event) are in @markaz/notifications.
 *
 * Like the emails, a push runs after the response, never throws and does nothing without an open database connection.
 */

let clientOverride: PushClient | null = null;
let depsOverride: PushDeps | null = null;

/** Test seams: a fake push service, or fake models altogether. Null goes back. */
export function setPushClient(client: PushClient | null): void {
  clientOverride = client;
}
export function setPushDeps(deps: PushDeps | null): void {
  depsOverride = deps;
}

export function sellerPushChannel(): PushChannel {
  return {
    client: clientOverride ?? notifications.createExpoPushClient({ accessToken: process.env.EXPO_PUSH_ACCESS_TOKEN }),
    onDeadToken: (token) => mongoMobileDeviceStore(MobileDevice as unknown as MobileDeviceModelPort).clearPushToken(token),
  };
}

const connected = async (): Promise<boolean> => mongoose.connection.readyState === 1;

function pushDeps(): PushDeps | null {
  if (depsOverride) return depsOverride;
  if (mongoose.connection.readyState !== 1) return null;
  const counters = mongoRateCounterStore(RateLimitCounter as unknown as Parameters<typeof mongoRateCounterStore>[0], connected);
  return {
    outbox: NotificationOutbox as unknown as NotificationOutboxModel,
    models: { devices: MobileDevice, users: User, stores: Store, members: StoreMember } as unknown as PushDeps['models'],
    channel: sellerPushChannel(),
    count: (key, expiresAt) => counters.increment(key, expiresAt),
  };
}

type Content = ReturnType<typeof notifications.pushContent.orderNew>;

interface StoreEvent {
  storeId: string;
  kind: PushKind;
  eventKey: string;
  content: Content;
  order?: string | null;
  /** The user who did the thing is not told about it. */
  exceptUserId?: string | null;
}

async function toStore(event: StoreEvent): Promise<PushEventResult | null> {
  try {
    const deps = pushDeps();
    if (!deps) return null;
    const users = (await notifications.storeRecipients(deps.models, event.storeId, event.kind)).filter((id) => id !== event.exceptUserId);
    return await notifications.sendPushEvent(deps, { app: 'seller', kind: event.kind, userIds: users, eventKey: event.eventKey, content: event.content, store: event.storeId, order: event.order ?? null });
  } catch (err) {
    console.error('[seller-backend] push failed', { kind: event.kind, error: notifications.errorText(err) });
    return null;
  }
}

async function toUsers(app: 'seller' | 'admin', kind: PushKind, userIds: readonly string[] | ((deps: PushDeps) => Promise<string[]>), eventKey: string, content: Content): Promise<PushEventResult | null> {
  try {
    const deps = pushDeps();
    if (!deps) return null;
    const users = typeof userIds === 'function' ? await userIds(deps) : userIds;
    return await notifications.sendPushEvent(deps, { app, kind, userIds: users, eventKey, content });
  } catch (err) {
    console.error('[seller-backend] push failed', { kind, error: notifications.errorText(err) });
    return null;
  }
}

const orderOf = (order: unknown): { id: string; orderNumber: string; total: number } => {
  const row = (order ?? {}) as { _id?: unknown; orderId?: unknown; total?: unknown };
  return { id: String(row._id ?? ''), orderNumber: typeof row.orderId === 'string' ? row.orderId : '', total: Number(row.total ?? 0) };
};

export async function pushOrderPlaced(storeId: string, order: unknown): Promise<PushEventResult | null> {
  const o = orderOf(order);
  if (o.id === '') return null;
  return toStore({ storeId, kind: 'order_new', eventKey: 'order_new:' + o.id, order: o.id, content: notifications.pushContent.orderNew({ storeId, orderId: o.id, orderNumber: o.orderNumber, total: o.total }) });
}

/** The shopper cancelled (said so on the confirmation call). The member who recorded it is not told. */
export async function pushOrderCancelled(storeId: string, order: unknown, actorUserId: string): Promise<PushEventResult | null> {
  const o = orderOf(order);
  if (o.id === '') return null;
  return toStore({
    storeId,
    kind: 'order_cancelled',
    eventKey: 'order_cancelled:' + o.id,
    order: o.id,
    exceptUserId: actorUserId,
    content: notifications.pushContent.orderCancelled({ storeId, orderId: o.id, orderNumber: o.orderNumber, total: o.total }),
  });
}

/** One push per stock alert, as one email per alert. */
export async function pushLowStock(storeId: string, alertId: string, quantity: number): Promise<PushEventResult | null> {
  return toStore({ storeId, kind: 'low_stock', eventKey: 'low_stock:' + alertId, content: notifications.pushContent.lowStock({ storeId, quantity }) });
}

export async function pushSubscriptionPayment(sellerId: string, paymentId: string, outcome: 'confirmed' | 'rejected' | 'voided', amount: number): Promise<PushEventResult | null> {
  return toUsers('seller', 'subscription_payment', [sellerId], 'sub_payment:' + paymentId + ':' + outcome, notifications.pushContent.subscriptionPayment({ confirmed: outcome === 'confirmed', amount }));
}

export async function pushSupportReply(sellerId: string, ticketId: string, revision: number): Promise<PushEventResult | null> {
  return toUsers('seller', 'support_reply', [sellerId], 'ticket_reply:' + ticketId + ':' + revision, notifications.pushContent.supportReply({ ticketId }));
}

export async function pushPaymentClaim(paymentId: string, amount: number): Promise<PushEventResult | null> {
  return toUsers('admin', 'payment_claim', (deps) => notifications.adminRecipients(deps.models, 'payment_claim'), 'payment_claim:' + paymentId, notifications.pushContent.paymentClaim({ paymentId, amount }));
}

export async function pushTicketNew(ticketId: string): Promise<PushEventResult | null> {
  return toUsers('admin', 'ticket_new', (deps) => notifications.adminRecipients(deps.models, 'ticket_new'), 'ticket_new:' + ticketId, notifications.pushContent.ticketNew({ ticketId }));
}
