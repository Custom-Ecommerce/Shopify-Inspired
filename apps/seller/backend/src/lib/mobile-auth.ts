import mongoose from 'mongoose';
import type { MobileDeviceModelPort, MobileDeviceStore, MobileRevokeReason, MobileSessionDeps } from '@markaz/auth';
import { requireSellerSecret } from '@/lib/accounts';
import { HttpError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import {
  assertAppVersion,
  createMinVersionReader,
  MOBILE_SELLER_AUDIENCE,
  MobileDevice,
  mongoMobileDeviceStore,
  PLATFORM_SETTINGS_GLOBAL_TYPE,
  PlatformSettingsModel,
  writeAuditLog,
} from '@/lib/services';
import { loadSellerAccount } from '@/lib/session-user';

/*
 * Sprint 9 (EP-31.US01): the seller backend's side of the phone sign-in. The token and device rules are shared (packages/auth/src/mobile-sessions.ts);
 * this file gives them the seller database.
 */

const databaseStore: MobileDeviceStore = mongoMobileDeviceStore(MobileDevice as unknown as MobileDeviceModelPort);
let override: MobileDeviceStore | null = null;

/** Test seam: keep the devices somewhere else. Pass null to go back to the database. */
export function setMobileDeviceStore(next: MobileDeviceStore | null): void {
  override = next;
}

/** The device store, connected first. 503 when the database cannot be reached: a phone token is never accepted unchecked. */
async function deviceStore(): Promise<MobileDeviceStore> {
  if (override !== null) return override;
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
  return databaseStore;
}

export async function sellerMobileDeps(): Promise<MobileSessionDeps> {
  const secret = requireSellerSecret();
  return { app: 'seller', role: 'seller', audience: MOBILE_SELLER_AUDIENCE, secret, devices: await deviceStore(), loadUser: loadSellerAccount };
}

/**
 * Closes every phone session of an account (password change, sign out everywhere, suspension). Best effort: a failure is logged and never undoes the change,
 * because the account itself (tokenVersion, accountStatus) is checked again on every request and every refresh. Without an open connection (a unit test of
 * another route) there is nothing to write to.
 */
export async function revokeSellerMobileDevices(userId: string, reason: MobileRevokeReason): Promise<void> {
  const store = override ?? (mongoose.connection.readyState === 1 ? databaseStore : null);
  if (store === null) return;
  try {
    await store.revokeAll({ app: 'seller', user: userId }, reason, new Date());
  } catch (err) {
    console.error('[seller-backend] could not close the phone sessions of an account', { reason, error: err instanceof Error ? err.message : 'unknown' });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The app version gate (EP-31.US01.T08)

async function loadMinVersion(): Promise<string | null> {
  await connectSellerDb();
  // A unit test of another route stubs the connection and never opens one: there is nothing to read, so no gate.
  if (mongoose.connection.readyState !== 1) return null;
  const doc = (await PlatformSettingsModel.findOne({ globalType: PLATFORM_SETTINGS_GLOBAL_TYPE } as never)
    .select('minSellerAppVersion')
    .lean()) as { minSellerAppVersion?: unknown } | null;
  return typeof doc?.minSellerAppVersion === 'string' && doc.minSellerAppVersion !== '' ? doc.minSellerAppVersion : null;
}

let versionReader = createMinVersionReader(loadMinVersion);

/** Test seam: where the minimum seller app version comes from. Null goes back to the platform settings. */
export function setMinSellerAppVersionLoader(load: (() => Promise<string | null>) | null): void {
  versionReader = createMinVersionReader(load ?? loadMinVersion, load ? 0 : 60_000);
}

/** 426 UPGRADE_REQUIRED when the request's app is older than the platform's minimum. */
export async function requireSellerAppVersion(headers: Headers): Promise<void> {
  assertAppVersion(headers, 'seller', await versionReader.read());
}

// ---------------------------------------------------------------------------------------------------------------------
// Audit (EP-31.US01.T09): best effort, and never a token in the line

export async function auditSellerMobile(action: 'mobile.sign_in' | 'mobile.sign_out' | 'mobile.refresh_reuse', userId: string, deviceId: string): Promise<void> {
  try {
    await writeAuditLog(action, 'user', userId, 'seller:' + userId, { device: deviceId, app: 'seller', at: new Date().toISOString() });
  } catch (err) {
    console.error('[seller-backend] could not write a phone sign-in audit entry', { action, error: err instanceof Error ? err.message : 'unknown' });
  }
}
