import * as authNs from '@markaz/auth';
import * as dbNs from '@markaz/db-schemas';
import * as syncNs from '@markaz/sync-core';
import { unwrapCjs } from '@/lib/cjs';

// The packages are CommonJS. Named imports of them fail under the ES module test runner, so the admin
// routes that the tests load read them through this module.
const auth = unwrapCjs(authNs);
const db = unwrapCjs(dbNs);
const sync = unwrapCjs(syncNs);

export const { assertCan, PolicyDeniedError, writeAuditLog, hashPassword, verifyPassword, signSession, verifySession, isLocked, recordFailedAttempt, SESSION_MIN_SECRET_LENGTH } = auth;
export const { AuditLog, Category, CommissionLedgerModel, PlatformSettingsModel, Store, SubscriptionPlanModel, SyncOutbox, User } = db;
export const { enqueueSyncEvent, registerSyncOutboxModel } = sync;
export type { SyncOutboxModelPort } from '@markaz/sync-core';
