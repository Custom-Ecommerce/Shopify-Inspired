import type { MobileApp } from './mobile-app';

/*
 * Sprint 9 (EP-31.US01.T08, D-120): the version gate of the phone apps. An app sends X-App-Version and X-App-Platform; when the platform settings name a
 * minimum version for that app and the phone is older (or says nothing), the answer is 426 UPGRADE_REQUIRED with the store link. No minimum, no gate.
 */

export const APP_VERSION_HEADER = 'x-app-version';
export const APP_PLATFORM_HEADER = 'x-app-platform';
export const UPGRADE_REQUIRED_CODE = 'UPGRADE_REQUIRED';

/** The Play Store pages. The package ids are the ones of apps/seller/mobile and apps/admin/mobile. */
export const APP_STORE_URLS: Readonly<Record<MobileApp, string>> = Object.freeze({
  seller: 'https://play.google.com/store/apps/details?id=com.markazify.seller',
  admin: 'https://play.google.com/store/apps/details?id=com.markazify.admin',
});

export class UpgradeRequiredError extends Error {
  readonly code = UPGRADE_REQUIRED_CODE;
  readonly minVersion: string;
  readonly storeUrl: string;

  constructor(minVersion: string, storeUrl: string) {
    super('Update the app to continue.');
    this.name = 'UpgradeRequiredError';
    this.minVersion = minVersion;
    this.storeUrl = storeUrl;
  }
}

/** "1.2.3" (a suffix such as -beta or +7 is ignored) as numbers, or null. */
export function parseAppVersion(value: unknown): number[] | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,5}(?:\.\d{1,5}){0,3})(?:[-+][0-9A-Za-z.-]*)?$/.exec(value.trim());
  return match ? match[1]!.split('.').map(Number) : null;
}

function older(sent: number[], minimum: number[]): boolean {
  for (let i = 0; i < Math.max(sent.length, minimum.length); i += 1) {
    const a = sent[i] ?? 0;
    const b = minimum[i] ?? 0;
    if (a !== b) return a < b;
  }
  return false;
}

/** Throws UpgradeRequiredError when `minimum` is a version and the request does not carry one at least as new. */
export function assertAppVersion(headers: Headers, app: MobileApp, minimum: string | null | undefined): void {
  const floor = parseAppVersion(minimum);
  if (!floor) return;
  const sent = parseAppVersion(headers.get(APP_VERSION_HEADER));
  if (!sent || older(sent, floor)) throw new UpgradeRequiredError(String(minimum).trim(), APP_STORE_URLS[app]);
}

/**
 * The minimum version, read through a cache of at most `ttlMs`. A read that fails lets the request through (the gate protects the app's behaviour, not
 * the data) and says so in the log.
 */
export function createMinVersionReader(load: () => Promise<string | null>, ttlMs: number = 60_000): { read(now?: number): Promise<string | null>; clear(): void } {
  let cached: { value: string | null; until: number } | null = null;
  return {
    async read(now = Date.now()) {
      if (cached && cached.until > now) return cached.value;
      try {
        cached = { value: await load(), until: now + ttlMs };
        return cached.value;
      } catch (err) {
        console.error('[app-version] could not read the minimum app version', { message: err instanceof Error ? err.message : 'unknown' });
        return null;
      }
    },
    clear() {
      cached = null;
    },
  };
}
