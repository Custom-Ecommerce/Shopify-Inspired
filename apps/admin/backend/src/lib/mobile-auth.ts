import mongoose from 'mongoose';
import type { MobileDeviceModelPort, MobileDeviceStore, MobileRevokeReason, MobileSessionDeps, SessionUserRecord } from '@markaz/auth';
import { connectDb } from '@/lib/db';
import {
  MOBILE_ADMIN_AUDIENCE,
  MobileDevice,
  PLATFORM_SETTINGS_GLOBAL_TYPE,
  PlatformSettingsModel,
  SESSION_MIN_SECRET_LENGTH,
  SESSION_USER_FIELDS,
  User,
  assertAppVersion,
  createMinVersionReader,
  effectiveAdminLevel,
  mongoMobileDeviceStore,
  toSessionUserRecord,
  writeAuditLog,
} from '@/lib/workspace';

/*
 * Sprint 9 (EP-31.US01.T06 to T09): the admin backend's side of the phone sign-in. The token and device rules are shared with the seller backend
 * (packages/auth/src/mobile-sessions.ts). This module imports nothing from admin-auth, which imports it.
 */

const databaseStore: MobileDeviceStore = mongoMobileDeviceStore(MobileDevice as unknown as MobileDeviceModelPort);
let override: MobileDeviceStore | null = null;

/** Test seam: keep the devices somewhere else. Pass null to go back to the database. */
export function setAdminMobileDeviceStore(next: MobileDeviceStore | null): void {
  override = next;
}

async function deviceStore(): Promise<MobileDeviceStore> {
  if (override !== null) return override;
  // A failure here is a 500 with no detail: a phone token is never accepted unchecked.
  await connectDb();
  return databaseStore;
}

/** The account behind a refresh, read fresh. An admin whose level is unknown has no rights at all, so it cannot refresh either. */
async function loadAdminAccount(userId: string): Promise<(SessionUserRecord & { adminLevel?: string }) | null> {
  const doc = (await User.findById(userId)
    .select(SESSION_USER_FIELDS + ' adminLevel')
    .lean()) as unknown as { adminLevel?: unknown } | null;
  const record = toSessionUserRecord(doc);
  const level = effectiveAdminLevel(doc?.adminLevel);
  return record && level !== null ? { ...record, adminLevel: level } : null;
}

/** The secret is checked by the callers (requireAdminSecret) before this is asked for. */
export async function adminMobileDeps(): Promise<MobileSessionDeps> {
  const secret = process.env.ADMIN_AUTH_SECRET ?? '';
  if (secret.length < SESSION_MIN_SECRET_LENGTH) throw new Error('ADMIN_AUTH_SECRET is not set');
  return { app: 'admin', role: 'admin', audience: MOBILE_ADMIN_AUDIENCE, secret, devices: await deviceStore(), loadUser: loadAdminAccount };
}

/** Closes every phone session of an operator. Best effort: the account is checked again on every request and every refresh anyway. */
export async function revokeAdminMobileDevices(userId: string, reason: MobileRevokeReason): Promise<void> {
  const store = override ?? (mongoose.connection.readyState === 1 ? databaseStore : null);
  if (store === null) return;
  try {
    await store.revokeAll({ app: 'admin', user: userId }, reason, new Date());
  } catch (err) {
    console.error('[admin-backend] could not close the phone sessions of an account', { reason, error: err instanceof Error ? err.message : 'unknown' });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The app version gate

async function loadMinVersion(): Promise<string | null> {
  await connectDb();
  if (mongoose.connection.readyState !== 1) return null;
  const doc = (await PlatformSettingsModel.findOne({ globalType: PLATFORM_SETTINGS_GLOBAL_TYPE } as never)
    .select('minAdminAppVersion')
    .lean()) as unknown as { minAdminAppVersion?: unknown } | null;
  return typeof doc?.minAdminAppVersion === 'string' && doc.minAdminAppVersion !== '' ? doc.minAdminAppVersion : null;
}

let versionReader = createMinVersionReader(loadMinVersion);

/** Test seam: where the minimum admin app version comes from. Null goes back to the platform settings. */
export function setMinAdminAppVersionLoader(load: (() => Promise<string | null>) | null): void {
  versionReader = createMinVersionReader(load ?? loadMinVersion, load ? 0 : 60_000);
}

export async function requireAdminAppVersion(headers: Headers): Promise<void> {
  assertAppVersion(headers, 'admin', await versionReader.read());
}

// ---------------------------------------------------------------------------------------------------------------------
// Audit: best effort, and never a token, secret or code in the line

export type AdminMobileAction =
  | 'mobile.sign_in'
  | 'mobile.sign_out'
  | 'mobile.refresh_reuse'
  | 'mobile.device_revoked'
  | 'mobile.totp_enrolled'
  | 'mobile.totp_recovery_used'
  | 'mobile.totp_reset';

export async function auditAdminMobile(action: AdminMobileAction, targetId: string, actorId: string, details: Record<string, unknown> = {}): Promise<void> {
  try {
    await writeAuditLog(action, 'user', targetId, actorId, { ...details, app: 'admin', at: new Date().toISOString() });
  } catch (err) {
    console.error('[admin-backend] could not write a phone sign-in audit entry', { action, error: err instanceof Error ? err.message : 'unknown' });
  }
}
