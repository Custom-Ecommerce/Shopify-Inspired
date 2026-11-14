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
export const { AuditLog, CommissionLedgerModel, PlatformSettingsModel, Store, SubscriptionPlanModel, SyncOutbox, User } = db;
export const { enqueueSyncEvent, registerSyncOutboxModel } = sync;
export type { SyncOutboxModelPort } from '@markaz/sync-core';

// Sprint 4 EP-08: the account guard, limits and flows, and the models they use (EP-07 outbox for the account emails).
export const { AuthToken, NotificationOutbox, RateLimitCounter } = db;
export const {
  createSessionGuard,
  toSessionUserRecord,
  sessionTokenVersion,
  SESSION_USER_FIELDS,
  SessionRejectedError,
  RateLimitedError,
  createAuthRateLimiter,
  mongoRateCounterStore,
  memoryRateCounterStore,
  LOGIN_ACCOUNT_RULE,
  LOGIN_IP_RULE,
  FORGOT_IP_RULE,
  FORGOT_EMAIL_RULE,
  RESET_IP_RULE,
  requestPasswordReset,
  resetPassword,
} = auth;
