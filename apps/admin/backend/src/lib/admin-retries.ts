import type { FailedEmailRow } from '../../../../../packages/contracts/src/admin-retries';
import { NotificationOutbox, SyncOutbox, writeAuditLog } from '@/lib/workspace';

/**
 * Sprint 6 EP-16 (S6-B7): audited retries. A dead sync event goes back to pending (attempts reset); a failed email goes back to queued. Each retry is ONE
 * compare-and-set on the status that was shown (dead / failed), so a row someone else already moved is skipped, never overwritten. At most 100 per call.
 * The failed-email list NEVER returns a payload or a body: the kind, a masked recipient, the attempts, an error CODE and the dates.
 * Capability sync.manage, declared by the route files. One audit entry per call (who, how many, which ids).
 */

export const RETRY_LIMIT = 100;

export const retrySteps = {
  audit: writeAuditLog as unknown as (action: string, entity: string, entityId: string, actorId: string, details: Record<string, unknown>) => Promise<unknown>,
  /** One compare-and-set: true when the row was in the expected status and was moved. */
  retrySync: async (id: string, now: Date): Promise<boolean> => {
    const r = (await SyncOutbox.updateOne({ _id: id, status: 'dead' } as never, { $set: { status: 'pending', attempts: 0, nextAttemptAt: now, lastError: null } } as never)) as { modifiedCount?: number };
    return (r.modifiedCount ?? 0) === 1;
  },
  retryEmail: async (id: string, now: Date): Promise<boolean> => {
    const r = (await NotificationOutbox.updateOne({ _id: id, status: 'failed', channel: { $ne: 'push' } } as never, { $set: { status: 'queued', attempts: 0, nextAttemptAt: now, lastError: null } } as never)) as { modifiedCount?: number };
    return (r.modifiedCount ?? 0) === 1;
  },
  listFailed: async (): Promise<Array<Record<string, any>>> =>
    (await NotificationOutbox.find({ status: 'failed', channel: { $ne: 'push' } } as never).select('template to attempts lastError createdAt updatedAt').sort({ updatedAt: -1 }).limit(200).lean()) as unknown as Array<Record<string, any>>,
  countFailed: async (): Promise<number> => NotificationOutbox.countDocuments({ status: 'failed', channel: { $ne: 'push' } } as never),
};

/** "ayesha@example.com" -> "a***@e***.com": enough to recognise, not enough to contact. */
export function maskRecipient(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return email[0] + '***@' + (host[0] ?? '') + '***' + tld;
}

/** The first word of the last error, reduced to safe characters: a code, never a message that may hold an address or a payload. */
export function errorCode(lastError: unknown): string | null {
  if (typeof lastError !== 'string') return null;
  const word = (lastError.trim().split(/\s+/)[0] ?? '').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 40);
  return word === '' ? null : word;
}

export function toFailedEmailRow(doc: Record<string, any>): FailedEmailRow {
  return {
    id: String(doc._id),
    kind: String(doc.template ?? ''),
    recipient: maskRecipient(String(doc.to ?? '')),
    attempts: Number.isInteger(doc.attempts) && doc.attempts >= 0 ? doc.attempts : 0,
    errorCode: errorCode(doc.lastError),
    createdAt: new Date(doc.createdAt ?? 0).toISOString(),
    updatedAt: new Date(doc.updatedAt ?? 0).toISOString(),
  };
}

export async function listFailedEmails(): Promise<{ docs: FailedEmailRow[]; totalDocs: number }> {
  const [rows, totalDocs] = await Promise.all([retrySteps.listFailed(), retrySteps.countFailed()]);
  return { docs: rows.map(toFailedEmailRow), totalDocs };
}

async function retryMany(kind: 'sync' | 'email', adminId: string, ids: readonly string[], now: Date): Promise<{ requested: number; retried: number; skipped: number }> {
  const unique = [...new Set(ids)].slice(0, RETRY_LIMIT);
  let retried = 0;
  for (const id of unique) {
    const moved = kind === 'sync' ? await retrySteps.retrySync(id, now) : await retrySteps.retryEmail(id, now);
    if (moved) retried += 1;
  }
  const result = { requested: unique.length, retried, skipped: unique.length - retried };
  try {
    await retrySteps.audit(kind === 'sync' ? 'sync.retry' : 'notification.retry', kind === 'sync' ? 'sync-outbox' : 'notification-outbox', 'retry', adminId, { ...result, ids: unique, at: now.toISOString() });
  } catch (err) {
    console.error('[admin-backend] could not write a retry audit entry', err instanceof Error ? err.message : 'unknown');
  }
  return result;
}

export const retryDeadEvents = (adminId: string, ids: readonly string[], now: Date = new Date()) => retryMany('sync', adminId, ids, now);
export const retryFailedEmails = (adminId: string, ids: readonly string[], now: Date = new Date()) => retryMany('email', adminId, ids, now);
