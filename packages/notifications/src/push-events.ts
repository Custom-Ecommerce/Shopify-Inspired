import { errorText } from './errors';
import { enqueuePush, type NotificationOutboxModel, type OutboxLog } from './outbox';
import { isQuietTime, PUSH_DAILY_QUOTA, PUSH_ROLE_TABLE, readPushPrefs, type PushApp, type PushChannel, type PushContent, type PushKind } from './push';

/*
 * Sprint 9 (EP-31.US02.T02, T04): one event becomes at most one push per user (and one row per phone of that user). The models come in as arguments, so the
 * seller and the admin backend share this and tests pass fakes. Nothing here throws to the caller.
 */

interface Query {
  select(fields: string): { lean(): PromiseLike<unknown> };
}
export interface PushReadModels {
  devices: { find(filter: Record<string, unknown>): Query };
  users: { find(filter: Record<string, unknown>): Query };
  stores: { findById(id: string): Query };
  members: { find(filter: Record<string, unknown>): Query };
}

export interface PushDeps {
  outbox: NotificationOutboxModel;
  models: PushReadModels;
  channel: PushChannel;
  /** Adds one to a counter that expires, answering the new value (the shared rate-limit counters). */
  count(key: string, expiresAt: Date): Promise<number>;
  now?: () => Date;
  /** How the first send of a row is started (a test passes its own). */
  schedule?: (run: () => Promise<void>) => void;
  log?: OutboxLog;
}

type Row = Record<string, unknown>;
const rowsOf = async (query: Query, fields: string): Promise<Row[]> => ((await query.select(fields).lean()) as Row[] | null) ?? [];

/** The users of a store whose role is in the table for this kind: the owner, and the active members. */
export async function storeRecipients(models: PushReadModels, storeId: string, kind: PushKind): Promise<string[]> {
  const roles = PUSH_ROLE_TABLE[kind];
  const store = (await models.stores.findById(storeId).select('owner').lean()) as { owner?: unknown } | null;
  if (!store) return [];
  const users = new Set<string>();
  if (roles.includes('owner') && store.owner) users.add(String(store.owner));
  for (const member of await rowsOf(models.members.find({ store: storeId, status: 'active' }), 'user role')) {
    if (member.user && roles.includes(String(member.role))) users.add(String(member.user));
  }
  return [...users];
}

/** The active admins whose level is in the table. A missing level reads as owner, an unknown one as nothing (the admin matrix rule). */
export async function adminRecipients(models: PushReadModels, kind: PushKind): Promise<string[]> {
  const levels = PUSH_ROLE_TABLE[kind];
  const admins = await rowsOf(models.users.find({ role: 'admin', accountStatus: { $in: ['active', null] } }), 'adminLevel');
  return admins.filter((admin) => levels.includes(String(admin.adminLevel ?? 'owner'))).map((admin) => String(admin._id));
}

export interface PushEvent {
  app: PushApp;
  kind: PushKind;
  userIds: readonly string[];
  /** Names the event ('order_new:<orderId>'): a user is told about it once. */
  eventKey: string;
  content: PushContent;
  store?: string | null;
  order?: string | null;
}

export interface PushEventResult {
  /** Rows written (one per phone). */
  queued: number;
  muted: number;
  duplicate: number;
  overQuota: number;
}

const DAY_MS = 86_400_000;

/**
 * Sends one event. For each user: skip when muted or in their quiet hours; skip when they were already told about this event; skip when today's quota is spent; then one outbox row
 * per live phone with a push token. A phone is live when its session is not revoked or expired and was signed in at the account's current tokenVersion.
 */
export async function sendPushEvent(deps: PushDeps, event: PushEvent): Promise<PushEventResult> {
  const result: PushEventResult = { queued: 0, muted: 0, duplicate: 0, overQuota: 0 };
  const log: OutboxLog = deps.log ?? ((line, detail) => console.error(line, detail ?? {}));
  try {
    const userIds = [...new Set(event.userIds)].filter((id) => id !== '');
    if (userIds.length === 0) return result;
    const now = (deps.now ?? (() => new Date()))();
    const [devices, users] = await Promise.all([
      rowsOf(deps.models.devices.find({ app: event.app, user: { $in: userIds }, revokedAt: null, refreshExpiresAt: { $gt: now }, pushToken: { $type: 'string' } }), 'user pushToken tokenVersion'),
      rowsOf(deps.models.users.find({ _id: { $in: userIds } }), 'accountStatus tokenVersion pushPrefs'),
    ]);
    const day = now.toISOString().slice(0, 10);

    for (const user of users) {
      const userId = String(user._id);
      if (user.accountStatus === 'suspended' || user.accountStatus === 'blocked') continue;
      const tokenVersion = typeof user.tokenVersion === 'number' ? user.tokenVersion : 0;
      const phones = devices.filter((d) => String(d.user) === userId && typeof d.pushToken === 'string' && d.pushToken !== '' && Number(d.tokenVersion ?? 0) === tokenVersion);
      if (phones.length === 0) continue;
      const prefs = readPushPrefs(user.pushPrefs);
      // Quiet hours drop the push (the alert and the order stay in the app); a dropped push does not use up the day's quota.
      if (prefs.muted || prefs.mutedKinds.includes(event.kind) || isQuietTime(prefs, now)) {
        result.muted += 1;
        continue;
      }
      const once = 'push-once:' + userId + ':' + event.eventKey;
      if ((await deps.count(once, new Date(now.getTime() + 2 * DAY_MS))) > 1) {
        result.duplicate += 1;
        continue;
      }
      if ((await deps.count('push-day:' + userId + ':' + day, new Date(now.getTime() + 2 * DAY_MS))) > PUSH_DAILY_QUOTA) {
        result.overQuota += 1;
        continue;
      }
      for (const phone of phones) {
        const outcome = await enqueuePush(
          deps.outbox,
          {
            to: String(phone.pushToken),
            title: event.content.title,
            body: event.content.body,
            data: event.content.data,
            app: event.app,
            kind: event.kind,
            dedupeKey: 'push:' + event.eventKey + ':' + userId + ':' + String(phone._id),
            store: event.store ?? null,
            order: event.order ?? null,
          },
          { push: deps.channel, schedule: deps.schedule, now: deps.now, log },
        );
        if (outcome.outcome === 'queued') result.queued += 1;
        else if (outcome.outcome === 'duplicate') result.duplicate += 1;
      }
    }
  } catch (err) {
    log('[push] could not send an event', { kind: event.kind, error: errorText(err) });
  }
  return result;
}
