import mongoose from 'mongoose';
import * as notificationsNs from '@markaz/notifications';
import type { MobileDeviceModelPort } from '@markaz/auth';
import type { PushChannel, PushClient, PushDeps, PushEventResult } from '@markaz/notifications';
import { outboxModel } from '@/lib/admin-account';
import { unwrapCjs } from '@/lib/cjs';
import { MobileDevice, RateLimitCounter, Store, StoreMember, User, mongoMobileDeviceStore, mongoRateCounterStore } from '@/lib/workspace';

const notifications: typeof notificationsNs = unwrapCjs(notificationsNs);

/**
 * Sprint 9 (EP-31.US02): the admin backend's side of push: the channel its flush sends with, and the one event that happens here (the sync drain gives up
 * on events). The rules are in @markaz/notifications.
 */

let clientOverride: PushClient | null = null;
let depsOverride: PushDeps | null = null;

export function setAdminPushClient(client: PushClient | null): void {
  clientOverride = client;
}
export function setAdminPushDeps(deps: PushDeps | null): void {
  depsOverride = deps;
}

export function adminPushChannel(): PushChannel {
  return {
    client: clientOverride ?? notifications.createExpoPushClient({ accessToken: process.env.EXPO_PUSH_ACCESS_TOKEN }),
    onDeadToken: (token) => mongoMobileDeviceStore(MobileDevice as unknown as MobileDeviceModelPort).clearPushToken(token),
  };
}

function pushDeps(): PushDeps | null {
  if (depsOverride) return depsOverride;
  if (mongoose.connection.readyState !== 1) return null;
  const counters = mongoRateCounterStore(RateLimitCounter as unknown as Parameters<typeof mongoRateCounterStore>[0], async () => mongoose.connection.readyState === 1);
  return {
    outbox: outboxModel(),
    models: { devices: MobileDevice, users: User, stores: Store, members: StoreMember } as unknown as PushDeps['models'],
    channel: adminPushChannel(),
    count: (key, expiresAt) => counters.increment(key, expiresAt),
  };
}

/** Tells owners and operations that sync events were given up on. At most one push an hour, however many runs find some. */
export async function pushSyncFailure(count: number, now: Date = new Date()): Promise<PushEventResult | null> {
  if (count <= 0) return null;
  try {
    const deps = pushDeps();
    if (!deps) return null;
    return await notifications.sendPushEvent(deps, {
      app: 'admin',
      kind: 'sync_failure',
      userIds: await notifications.adminRecipients(deps.models, 'sync_failure'),
      eventKey: 'sync_failure:' + now.toISOString().slice(0, 13),
      content: notifications.pushContent.syncFailure({ count }),
    });
  } catch (err) {
    console.error('[admin-backend] push failed', { kind: 'sync_failure', error: notifications.errorText(err) });
    return null;
  }
}
