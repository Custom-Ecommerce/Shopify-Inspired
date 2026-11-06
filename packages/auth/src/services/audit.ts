import { AuditLog } from '@markaz/db-schemas';
import { assertCan } from '../can';
import type { Actor } from '../policy';


/** Fixed, never caller-supplied. The matrix allows only 'system' to create audit entries. */
const SYSTEM_ACTOR: Actor = 'system';
const AUDIT_COLLECTION = 'audit-log';


export interface WrittenAuditLog {
  id: string;
}


function requireNonEmpty(name: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('writeAuditLog: ' + name + ' must be a non-empty string');
  }
  return value;
}


/**
 * Append one audit entry. actorId is the human or service the action is
 * attributed to; the policy actor that performs the write is always 'system'.
 * Entries are immutable: this module exposes no update or delete.
 */
export async function writeAuditLog(
  action: string,
  entity: string,
  entityId: string,
  actorId: string,
  details?: any,
): Promise<WrittenAuditLog> {
  assertCan(SYSTEM_ACTOR, 'create', AUDIT_COLLECTION);


  requireNonEmpty('action', action);
  requireNonEmpty('entity', entity);
  requireNonEmpty('entityId', entityId);
  requireNonEmpty('actorId', actorId);


  const entry = await AuditLog.create({
    action,
    entity,
    entityId,
    actorId,
    ...(details === undefined ? {} : { details }),
  });


  return { id: String(entry._id) };
}
