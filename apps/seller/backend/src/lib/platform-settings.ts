import { PLATFORM_SETTINGS_GLOBAL_TYPE, PlatformSettingsModel } from '@/lib/services';

/** D-098 A1: what the seller backend knows of the platform settings. Defaults apply when nothing says otherwise. */
export interface PlatformSettingsView {
  storeApprovalRequired: boolean;
  /** The commission percent on gateway (card) orders when a store has no custom rate of its own. */
  defaultCommissionRate: number;
  /** Sprint 6 D-116: the commission percent on cash-on-delivery orders. 0 by default; a store's custom rate never applies to COD. */
  codCommissionPercent: number;
  /** Sprint 6 EP-12: the platform's store limit per seller, or null when the settings document has none. */
  maxStoresPerSeller: number | null;
}

/** Sprint 6 D-118: the plan settings a seller sees (manual payment instructions, grace, trial, support contact). */
export interface PlanSettingsView {
  /** Plain text as the admin typed it. Never HTML: whoever renders it must escape it. Null when not set. */
  paymentInstructions: string | null;
  graceDays: number;
  trialDays: number;
  supportEmail: string | null;
  supportPhone: string | null;
}

export const DEFAULT_STORE_APPROVAL_REQUIRED = false;
export const DEFAULT_COMMISSION_RATE = 4;
export const DEFAULT_COD_COMMISSION_PERCENT = 0;
export const DEFAULT_GRACE_DAYS = 7;
export const DEFAULT_TRIAL_DAYS = 0;

function validRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

function validDays(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
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

/** D-116: COD_COMMISSION_PERCENT, 0 to 100; missing or unusable means 0 (no commission on cash on delivery). */
function envCodRate(): number {
  const raw = (process.env.COD_COMMISSION_PERCENT ?? '').trim();
  if (raw === '') return DEFAULT_COD_COMMISSION_PERCENT;
  const value = Number(raw);
  return validRate(value) ? value : DEFAULT_COD_COMMISSION_PERCENT;
}

type SettingsDoc = Record<string, unknown>;

async function readSettingsDoc(select: string): Promise<SettingsDoc | null> {
  try {
    return (await PlatformSettingsModel.findOne({ globalType: PLATFORM_SETTINGS_GLOBAL_TYPE }).select(select).lean()) as SettingsDoc | null;
  } catch {
    return null;
  }
}

/**
 * The settings document in this database first (the admin console's copy, or the replica the sync receiver keeps), then the
 * environment, then the defaults (approval off, rate 4, COD 0). Each value falls back on its own. Never throws on a read failure.
 */
export async function readPlatformSettings(): Promise<PlatformSettingsView> {
  const doc = await readSettingsDoc('storeApprovalRequired defaultCommissionRate codCommissionPercent maxStoresPerSeller');
  const max = doc?.maxStoresPerSeller;
  return {
    storeApprovalRequired: typeof doc?.storeApprovalRequired === 'boolean' ? doc.storeApprovalRequired : envApproval(),
    defaultCommissionRate: validRate(doc?.defaultCommissionRate) ? doc.defaultCommissionRate : envRate(),
    codCommissionPercent: validRate(doc?.codCommissionPercent) ? doc.codCommissionPercent : envCodRate(),
    maxStoresPerSeller: typeof max === 'number' && Number.isInteger(max) && max >= 1 ? max : null,
  };
}

/** The plan settings (D-118): the document first, then the defaults (7 days of grace, no trial, no texts). Never throws. */
export async function readPlanSettings(): Promise<PlanSettingsView> {
  const doc = await readSettingsDoc('paymentInstructions graceDays trialDays supportEmail supportPhone');
  return {
    paymentInstructions: textOrNull(doc?.paymentInstructions),
    graceDays: validDays(doc?.graceDays, 30) ? doc.graceDays : DEFAULT_GRACE_DAYS,
    trialDays: validDays(doc?.trialDays, 60) ? doc.trialDays : DEFAULT_TRIAL_DAYS,
    supportEmail: textOrNull(doc?.supportEmail),
    supportPhone: textOrNull(doc?.supportPhone),
  };
}
