import { toIso, type Doc, type Issue } from '@/lib/admin-stores';

/**
 * Pure helpers for the admin platform settings endpoint: request validation, the wire shape, the change set, and the
 * Mongo updates (apply and revert). No I/O. The limits are the same as ADMIN_SETTINGS_* in @markaz/contracts
 * (admin-settings.ts); the console checks them first and this module checks them again, because no route trusts the
 * browser. Rates are percentages (ID-18).
 */

export const SETTINGS_RATE_MIN = 0;
export const SETTINGS_RATE_MAX = 100;
export const SETTINGS_MAX_STORES_MIN = 1;
export const SETTINGS_MAX_STORES_MAX = 1000;
export const SETTINGS_NOTE_MAX = 500;
export const SETTINGS_REASON_MAX = 500;

/**
 * The fields an operator may write (ADMIN_PLATFORM_SETTINGS_WRITABLE_FIELDS in the policy matrix). Passed to the
 * policy check, so a field added later is denied until declared. settingsRevision is not here: only the server moves it.
 */
export const SETTINGS_FIELDS = ['defaultCommissionRate', 'maxStoresPerSeller', 'stripeCommissionNote', 'storeApprovalRequired'] as const;
export type SettingsField = (typeof SETTINGS_FIELDS)[number];

/** The fields in the seller sync allowlist (SETTINGS_ALLOWLIST in platform-kit). A change to the note is not sent. */
export const SYNCED_SETTINGS_FIELDS: readonly SettingsField[] = ['defaultCommissionRate', 'maxStoresPerSeller', 'storeApprovalRequired'];

/** What the model defaults to (platform-settings.ts), used when the stored document lacks a value. */
export const DEFAULT_COMMISSION_RATE = 4;
export const DEFAULT_MAX_STORES_PER_SELLER = 3;

export const CONFLICT_MESSAGE = 'The settings were changed by someone else. Reload and try again.';
export const NOT_SET_UP_MESSAGE = 'Platform settings have not been set up';

export interface SettingsChange {
  defaultCommissionRate?: number;
  maxStoresPerSeller?: number;
  stripeCommissionNote?: string | null;
  /** Sprint 4 D-094/D-095: go-live waits for an admin when true. */
  storeApprovalRequired?: boolean;
}

export interface SettingsUpdate {
  changes: SettingsChange;
  reason: string | null;
}

export type ParsedSettingsUpdate = { ok: true; data: SettingsUpdate } | { ok: false; issues: Issue[] };

const WRITABLE = new Set<string>([...SETTINGS_FIELDS, 'reason']);

/**
 * Reads and checks whichever settings are present. Unknown fields are refused, not ignored (settingsRevision
 * included). At least one setting must be sent. A blank note clears it. The reason is kept for the audit entry only.
 */
export function parseSettingsUpdate(input: unknown): ParsedSettingsUpdate {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, issues: [{ path: 'body', message: 'must be a JSON object' }] };
  }
  const issues: Issue[] = [];
  const record = input as Record<string, unknown>;
  const changes: SettingsChange = {};
  let reason: string | null = null;
  for (const key of Object.keys(record)) {
    if (!WRITABLE.has(key)) issues.push({ path: key, message: 'is not a platform setting' });
  }

  if ('defaultCommissionRate' in record) {
    const value = record.defaultCommissionRate;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < SETTINGS_RATE_MIN || value > SETTINGS_RATE_MAX) {
      issues.push({ path: 'defaultCommissionRate', message: 'must be a number from ' + SETTINGS_RATE_MIN + ' to ' + SETTINGS_RATE_MAX });
    } else changes.defaultCommissionRate = value;
  }

  if ('maxStoresPerSeller' in record) {
    const value = record.maxStoresPerSeller;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < SETTINGS_MAX_STORES_MIN || value > SETTINGS_MAX_STORES_MAX) {
      issues.push({ path: 'maxStoresPerSeller', message: 'must be a whole number from ' + SETTINGS_MAX_STORES_MIN + ' to ' + SETTINGS_MAX_STORES_MAX });
    } else changes.maxStoresPerSeller = value;
  }

  if ('stripeCommissionNote' in record) {
    const value = record.stripeCommissionNote;
    if (value === null) changes.stripeCommissionNote = null;
    else if (typeof value !== 'string') issues.push({ path: 'stripeCommissionNote', message: 'must be text or null' });
    else if (value.trim().length > SETTINGS_NOTE_MAX) issues.push({ path: 'stripeCommissionNote', message: 'must be at most ' + SETTINGS_NOTE_MAX + ' characters' });
    else changes.stripeCommissionNote = value.trim() === '' ? null : value.trim();
  }

  if ('storeApprovalRequired' in record) {
    const value = record.storeApprovalRequired;
    if (typeof value !== 'boolean') issues.push({ path: 'storeApprovalRequired', message: 'must be true or false' });
    else changes.storeApprovalRequired = value;
  }

  if ('reason' in record) {
    const value = record.reason;
    const text = typeof value === 'string' ? value.trim() : '';
    if (typeof value !== 'string' || text === '' || text.length > SETTINGS_REASON_MAX) {
      issues.push({ path: 'reason', message: 'must be text of 1 to ' + SETTINGS_REASON_MAX + ' characters' });
    } else reason = text;
  }

  if (issues.length === 0 && Object.keys(changes).length === 0) issues.push({ path: 'body', message: 'change at least one setting' });
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, data: { changes, reason } };
}

function isRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= SETTINGS_RATE_MIN && value <= SETTINGS_RATE_MAX;
}

function isStoreLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= SETTINGS_MAX_STORES_MIN;
}

/** The settings as the console reads them. A value the document lacks or holds unusably shows the model default. */
export function toSettingsRow(doc: Doc) {
  const revision = doc.settingsRevision;
  const note = doc.stripeCommissionNote;
  return {
    defaultCommissionRate: isRate(doc.defaultCommissionRate) ? doc.defaultCommissionRate : DEFAULT_COMMISSION_RATE,
    maxStoresPerSeller: isStoreLimit(doc.maxStoresPerSeller) ? doc.maxStoresPerSeller : DEFAULT_MAX_STORES_PER_SELLER,
    stripeCommissionNote: typeof note === 'string' && note !== '' ? note : null,
    storeApprovalRequired: doc.storeApprovalRequired === true,
    settingsRevision: typeof revision === 'number' && Number.isInteger(revision) && revision >= 0 ? revision : 0,
    updatedAt: toIso(doc.updatedAt),
  };
}

export type SettingsRow = ReturnType<typeof toSettingsRow>;

/** What an audit entry keeps of the settings: the writable fields, nothing else. */
export function settingsSnapshot(row: SettingsRow): Required<SettingsChange> {
  return {
    defaultCommissionRate: row.defaultCommissionRate,
    maxStoresPerSeller: row.maxStoresPerSeller,
    stripeCommissionNote: row.stripeCommissionNote,
    storeApprovalRequired: row.storeApprovalRequired,
  };
}

/** The fields whose value would change, in the order of SETTINGS_FIELDS. A value sent equal to the current one is not a change. */
export function changedFields(before: SettingsRow, changes: SettingsChange): SettingsField[] {
  return SETTINGS_FIELDS.filter((field) => field in changes && changes[field] !== before[field]);
}

/** The stored value of one setting, read raw: a missing rate or limit, or an empty note, is null. */
function storedValueOf(stored: Doc, field: SettingsField): unknown {
  const value = stored[field];
  if (field === 'stripeCommissionNote') return typeof value === 'string' && value !== '' ? value : null;
  if (field === 'storeApprovalRequired') return typeof value === 'boolean' ? value : null;
  return typeof value === 'number' ? value : null;
}

/**
 * The fields whose value would change against what is stored, read raw. Not the displayed values: a stored value that
 * is missing shows its model default, so comparing with the display would treat saving that default as no change, and
 * the stored value would stay missing while the console reported success.
 */
export function changedFieldsAgainstStored(stored: Doc, changes: SettingsChange): SettingsField[] {
  return SETTINGS_FIELDS.filter((field) => field in changes && changes[field] !== storedValueOf(stored, field));
}

/** True when a changed field is one the seller receives, so the change needs a sync event. */
export function needsSync(changed: readonly SettingsField[]): boolean {
  return changed.some((field) => SYNCED_SETTINGS_FIELDS.includes(field));
}

/**
 * The compare-and-set filter: the write applies only if the revision is still the one that was read. A document that
 * has never been bumped (no revision, or 0) matches both, as the dispatcher's bootstrap does.
 */
export function revisionFilter(id: string, revision: number): Doc {
  return { _id: id, settingsRevision: revision === 0 ? { $in: [0, null] } : revision };
}

/**
 * The update for a change: the changed fields, and the revision advanced by one so the seller's replica orders it.
 * A cleared note is removed from the document rather than stored as null.
 */
export function buildSettingsUpdate(changes: SettingsChange, changed: readonly SettingsField[]): Doc {
  const set: Doc = {};
  const unset: Doc = {};
  for (const field of changed) {
    const value = changes[field];
    if (value === null || value === undefined) unset[field] = 1;
    else set[field] = value;
  }
  const update: Doc = { $inc: { settingsRevision: 1 } };
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(unset).length > 0) update.$unset = unset;
  return update;
}

/**
 * Puts a change back: each changed field gets the stored value it had (read raw, before the change), or is removed if
 * the document had none, and the revision returns to what it was. Apply it only where the revision is still the one
 * the change set (revisionFilter), so a later write is never overwritten.
 */
export function buildRevertUpdate(stored: Doc, changed: readonly SettingsField[], revisionBefore: number): Doc {
  const set: Doc = { settingsRevision: revisionBefore };
  const unset: Doc = {};
  for (const field of changed) {
    if (stored[field] === undefined || stored[field] === null) unset[field] = 1;
    else set[field] = stored[field];
  }
  const update: Doc = { $set: set };
  if (Object.keys(unset).length > 0) update.$unset = unset;
  return update;
}
