/**
 * Sprint 6 EP-12.US02.T01 (D-118): the effective limits of a seller. Pure: no I/O, no clock, no environment read (the caller passes
 * every input), so every step of the precedence can be tested on its own.
 *
 * Store limit, first one that applies wins:
 *
 *   1. override  the seller's own storeLimitOverride, set by an admin with a reason (integer 1 or more)
 *   2. plan      the limit of the seller's effective plan (EP-14); the input is optional until that plan resolver exists
 *   3. setting   the platform setting maxStoresPerSeller
 *   4. env       SELLER_MAX_STORES, or the built-in 3 when that is missing or unusable
 *
 * A value that is not a whole number of 1 or more (missing, null, 0, a fraction, text) is skipped, never treated as a limit, so a
 * broken input falls through to the next step instead of locking a seller out.
 */

export const STORE_LIMIT_SOURCES = ['override', 'plan', 'setting', 'env'] as const;
export type StoreLimitSource = (typeof STORE_LIMIT_SOURCES)[number];

/** The limit when nothing else says: the long-standing platform default of 3 stores per seller. */
export const DEFAULT_ENV_STORE_LIMIT = 3;

export interface StoreLimitInputs {
  /** User.storeLimitOverride: an integer of 1 or more, or null/missing for none. */
  override?: unknown;
  /** The plan's store limit (EP-14). Optional until the plan resolver exists. */
  planLimit?: unknown;
  /** PlatformSettings.maxStoresPerSeller. */
  platformMax?: unknown;
  /** The raw SELLER_MAX_STORES value (or an already parsed number). */
  envMax?: unknown;
}

export interface EffectiveStoreLimit {
  limit: number;
  source: StoreLimitSource;
}

/** A whole number of 1 or more, or null. */
export function positiveWhole(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : null;
}

/** SELLER_MAX_STORES as the environment holds it ("5"), a number, or nothing: a whole number of 1 or more, else null. */
export function parseEnvStoreLimit(raw: unknown): number | null {
  if (typeof raw === 'number') return positiveWhole(raw);
  if (typeof raw !== 'string') return null;
  // parseInt, as the limit has always been read: "5" is 5, "abc", "0" and "-2" are nothing.
  return positiveWhole(Number.parseInt(raw, 10));
}

/** The store limit of a seller and where it comes from. Never below 1. */
export function resolveStoreLimit(inputs: StoreLimitInputs): EffectiveStoreLimit {
  const override = positiveWhole(inputs.override);
  if (override !== null) return { limit: override, source: 'override' };
  const plan = positiveWhole(inputs.planLimit);
  if (plan !== null) return { limit: plan, source: 'plan' };
  const setting = positiveWhole(inputs.platformMax);
  if (setting !== null) return { limit: setting, source: 'setting' };
  return { limit: parseEnvStoreLimit(inputs.envMax) ?? DEFAULT_ENV_STORE_LIMIT, source: 'env' };
}
