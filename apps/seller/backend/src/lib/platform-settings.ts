import { PLATFORM_SETTINGS_GLOBAL_TYPE, PlatformSettingsModel } from '@/lib/services';

/** D-098 A1: what the seller backend knows of the platform settings. Defaults apply when nothing says otherwise. */
export interface PlatformSettingsView {
  storeApprovalRequired: boolean;
  defaultCommissionRate: number;
}

export const DEFAULT_STORE_APPROVAL_REQUIRED = false;
export const DEFAULT_COMMISSION_RATE = 4;

function validRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

/** Env fallback for a setup where the settings document has not reached this database: 'true' / '1' for approval, a number for the rate. */
function envApproval(): boolean {
  const raw = (process.env.PLATFORM_STORE_APPROVAL_REQUIRED ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' ? true : DEFAULT_STORE_APPROVAL_REQUIRED;
}

function envRate(): number {
  const raw = (process.env.PLATFORM_DEFAULT_COMMISSION_PERCENT ?? '').trim();
  if (raw === '') return DEFAULT_COMMISSION_RATE;
  const value = Number(raw);
  return validRate(value) ? value : DEFAULT_COMMISSION_RATE;
}

/**
 * The settings document in this database first (the admin console's copy, or the replica the sync receiver keeps), then the
 * environment, then the defaults (approval off, rate 4). Each value falls back on its own. Never throws on a read failure.
 */
export async function readPlatformSettings(): Promise<PlatformSettingsView> {
  let doc: { storeApprovalRequired?: unknown; defaultCommissionRate?: unknown } | null = null;
  try {
    doc = (await PlatformSettingsModel.findOne({ globalType: PLATFORM_SETTINGS_GLOBAL_TYPE })
      .select('storeApprovalRequired defaultCommissionRate')
      .lean()) as typeof doc;
  } catch {
    doc = null;
  }
  return {
    storeApprovalRequired: typeof doc?.storeApprovalRequired === 'boolean' ? doc.storeApprovalRequired : envApproval(),
    defaultCommissionRate: validRate(doc?.defaultCommissionRate) ? doc.defaultCommissionRate : envRate(),
  };
}
