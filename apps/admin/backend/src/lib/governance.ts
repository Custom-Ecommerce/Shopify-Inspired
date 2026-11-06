import type { Doc, Issue } from '@/lib/admin-stores';

/** Governance writes: the transition rules, the update that applies one, and the update that undoes it. Pure. */

export const GOVERNANCE_STATUSES = ['active', 'suspended'] as const;
export type GovernanceStatus = (typeof GOVERNANCE_STATUSES)[number];
export const REASON_MIN = 3;
export const REASON_MAX = 500;
export const NOTE_MAX = 1000;

/** The store fields a status change writes. Every one is in the admin's writable list in the policy matrix. */
export const GOVERNANCE_FIELDS = ['status', 'suspensionReason', 'suspensionNote', 'suspendedAt', 'statusChangedAt'] as const;

export interface StatusChangeInput {
  status: GovernanceStatus;
  reason: string;
  note: string | null;
}

export type ParsedStatusChange = { ok: true; data: StatusChangeInput } | { ok: false; issues: Issue[] };

export function parseStatusChange(input: unknown): ParsedStatusChange {
  const issues: Issue[] = [];
  const body = typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Doc) : {};
  const status = body.status;
  if (typeof status !== 'string' || !(GOVERNANCE_STATUSES as readonly string[]).includes(status)) {
    issues.push({ path: 'status', message: 'must be active or suspended' });
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
    issues.push({ path: 'reason', message: 'is required (' + REASON_MIN + ' to ' + REASON_MAX + ' characters)' });
  }
  let note: string | null = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string' || body.note.trim().length > NOTE_MAX) {
      issues.push({ path: 'note', message: 'must be text of at most ' + NOTE_MAX + ' characters' });
    } else if (body.note.trim() !== '') {
      note = body.note.trim();
    }
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, data: { status: status as GovernanceStatus, reason, note } };
}

export interface StoreStateBefore {
  status: string;
  suspensionReason: string | null;
  suspensionNote: string | null;
  suspendedAt: Date | null;
  statusChangedAt: Date | null;
}

export interface MongoUpdate {
  $set: Doc;
  $unset?: Doc;
}

export type StatusPlan =
  | { ok: true; action: 'suspend' | 'activate'; update: MongoUpdate }
  | { ok: false; message: string };

/**
 * Suspend applies to an active store. Activate applies to a suspended store, and to a pending one (its first
 * activation). An archived store is not changed from the console. Activating clears the suspension fields; the
 * reason stays in the audit log.
 */
export function planStatusChange(current: string, input: StatusChangeInput, now: Date): StatusPlan {
  if (current === 'archived') return { ok: false, message: 'An archived store cannot be changed from the console' };
  if (current === input.status) return { ok: false, message: 'The store is already ' + current };

  if (input.status === 'suspended') {
    if (current !== 'active') return { ok: false, message: 'Only an active store can be suspended' };
    const update: MongoUpdate = {
      $set: { status: 'suspended', suspensionReason: input.reason, suspendedAt: now, statusChangedAt: now },
    };
    if (input.note !== null) update.$set.suspensionNote = input.note;
    else update.$unset = { suspensionNote: '' };
    return { ok: true, action: 'suspend', update };
  }

  if (current !== 'suspended' && current !== 'pending') return { ok: false, message: 'Only a suspended or pending store can be activated' };
  return {
    ok: true,
    action: 'activate',
    update: { $set: { status: 'active', statusChangedAt: now }, $unset: { suspensionReason: '', suspensionNote: '', suspendedAt: '' } },
  };
}

/** The update that puts the governance fields back as they were, for when a step after the write fails. */
export function revertUpdate(before: StoreStateBefore): MongoUpdate {
  const set: Doc = { status: before.status };
  const unset: Doc = {};
  const fields: Array<[keyof StoreStateBefore, unknown]> = [
    ['suspensionReason', before.suspensionReason],
    ['suspensionNote', before.suspensionNote],
    ['suspendedAt', before.suspendedAt],
    ['statusChangedAt', before.statusChangedAt],
  ];
  for (const [field, value] of fields) {
    if (value === null || value === undefined) unset[field] = '';
    else set[field] = value;
  }
  return Object.keys(unset).length > 0 ? { $set: set, $unset: unset } : { $set: set };
}

export function readBefore(doc: Doc): StoreStateBefore {
  const asDate = (v: unknown): Date | null => (v instanceof Date ? v : typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);
  const asText = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  return {
    status: String(doc.status),
    suspensionReason: asText(doc.suspensionReason),
    suspensionNote: asText(doc.suspensionNote),
    suspendedAt: asDate(doc.suspendedAt),
    statusChangedAt: asDate(doc.statusChangedAt),
  };
}
