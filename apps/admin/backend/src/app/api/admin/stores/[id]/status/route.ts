import { AdminHttpError, errorResponse } from '@/lib/admin-auth';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { isObjectId, toIso, type Doc } from '@/lib/admin-stores';
import { GOVERNANCE_FIELDS, parseStatusChange, planStatusChange, readBefore, revertUpdate, type StoreStateBefore } from '@/lib/governance';
import {
  assertCan,
  enqueueSyncEvent,
  registerSyncOutboxModel,
  Store,
  SyncOutbox,
  writeAuditLog,
  type SyncOutboxModelPort,
} from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

registerSyncOutboxModel(SyncOutbox as unknown as SyncOutboxModelPort);

const BEFORE_FIELDS = 'name status suspensionReason suspensionNote suspendedAt statusChangedAt govRevision';

export interface StatusRouteContext {
  params: Promise<{ id: string }>;
}

function snapshot(doc: Doc): Doc {
  return {
    status: doc.status ?? null,
    suspensionReason: doc.suspensionReason ?? null,
    suspensionNote: doc.suspensionNote ?? null,
    suspendedAt: toIso(doc.suspendedAt),
  };
}

/**
 * Puts the store back as it was read, including its governance revision. Returns whether the store was restored,
 * so the caller can say so. Audit entries are immutable, so a change that was audited but not completed is recorded
 * by a compensating entry rather than by editing the original.
 */
async function rollBack(args: {
  id: string;
  actorId: string;
  before: StoreStateBefore;
  revisionBefore: number;
  appliedAt: Date;
  attempted: string;
  reason: string;
  auditWritten: boolean;
}): Promise<boolean> {
  let restored = false;
  try {
    const undo = revertUpdate(args.before);
    const result = await Store.updateOne(
      { _id: args.id, statusChangedAt: args.appliedAt } as never,
      { ...undo, $set: { ...undo.$set, govRevision: args.revisionBefore } } as never,
    );
    restored = result.matchedCount === 1;
  } catch (err) {
    console.error('store status rollback failed:', err instanceof Error ? err.message : 'unknown error');
  }

  if (args.auditWritten) {
    try {
      await writeAuditLog('store.change_rolled_back', 'store', args.id, args.actorId, {
        reason: args.reason,
        note: 'Not completed. Attempted status: ' + args.attempted + '. Store ' + (restored ? 'restored.' : 'NOT restored; check it before retrying.'),
        restored,
      });
    } catch (err) {
      console.error('compensating audit entry failed:', err instanceof Error ? err.message : 'unknown error');
    }
  }
  return restored;
}

/**
 * POST /api/admin/stores/:id/status. The session-facing governance write (ID-29): suspend or activate a store with
 * a mandatory reason. The write is conditional on the status that was read, so two operators cannot both win. It
 * advances the governance revision, which is what the dispatcher publishes and the seller checks for staleness. It
 * is then audited and queued for the seller; if either step fails, the store is put back and the call fails.
 */
export async function POST(request: Request, context: StatusRouteContext): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request);
    requirePolicy(() => {
      assertCan('admin', 'update', 'stores', GOVERNANCE_FIELDS);
      assertCan('system', 'create', 'sync-outbox');
    });
    const { id } = await context.params;
    if (!isObjectId(id)) throw new AdminHttpError(404, 'Store not found');

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw new AdminHttpError(400, 'Body must be JSON');
    }
    const input = parseStatusChange(raw);
    if (!input.ok) return Response.json({ error: 'Invalid request', issues: input.issues }, { status: 422, headers: NO_STORE });

    const found = (await Store.findById(id).select(BEFORE_FIELDS).lean()) as unknown as Doc | null;
    if (!found) throw new AdminHttpError(404, 'Store not found');
    const before = readBefore(found);
    const revisionBefore = typeof found.govRevision === 'number' ? found.govRevision : 0;

    const now = new Date();
    const plan = planStatusChange(before.status, input.data, now);
    if (!plan.ok) throw new AdminHttpError(409, plan.message);

    const applied = await Store.updateOne(
      { _id: id, status: before.status } as never,
      { ...plan.update, $inc: { govRevision: 1 } } as never,
    );
    if (applied.matchedCount === 0) throw new AdminHttpError(409, 'The store was changed by someone else. Reload and try again.');

    let queued: { eventId: string; revision: number } | null = null;
    let auditWritten = false;
    try {
      await writeAuditLog('store.' + plan.action, 'store', id, userId, {
        reason: input.data.reason,
        note: input.data.note,
        before: snapshot(found),
        after: { status: input.data.status, suspensionReason: plan.action === 'suspend' ? input.data.reason : null },
      });
      auditWritten = true;
      const event = await enqueueSyncEvent({
        target: 'seller',
        entity: 'store',
        entityId: id,
        group: 'governance',
        payload: { status: input.data.status },
      });
      queued = { eventId: event.eventId, revision: event.revision };
    } catch (err) {
      console.error('store status change failed:', err instanceof Error ? err.message : 'unknown error');
      const restored = await rollBack({
        id,
        actorId: userId,
        before,
        revisionBefore,
        appliedAt: now,
        attempted: input.data.status,
        reason: input.data.reason,
        auditWritten,
      });
      if (!restored) {
        throw new AdminHttpError(500, 'The change could not be recorded, and the store could not be restored. Check the store before doing anything else.');
      }
      throw new AdminHttpError(500, 'The change could not be recorded and was not applied');
    }

    const suspended = plan.action === 'suspend';
    return Response.json(
      {
        store: {
          id,
          status: input.data.status,
          suspensionReason: suspended ? input.data.reason : null,
          suspensionNote: suspended ? input.data.note : null,
          suspendedAt: suspended ? now.toISOString() : null,
          statusChangedAt: now.toISOString(),
        },
        queued,
      },
      { status: 200, headers: NO_STORE },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
