import { AdminHttpError, errorResponse } from '@/lib/admin-auth';
import { SETTINGS_GLOBAL_TYPE } from '@/lib/admin-commission';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import {
  CONFLICT_MESSAGE,
  NOT_SET_UP_MESSAGE,
  SETTINGS_FIELDS,
  buildRevertUpdate,
  buildSettingsUpdate,
  changedFieldsAgainstStored,
  needsSync,
  parseSettingsUpdate,
  revisionFilter,
  settingsSnapshot,
  toSettingsRow,
} from '@/lib/admin-settings';
import type { Doc } from '@/lib/admin-stores';
import {
  assertCan,
  enqueueSyncEvent,
  PlatformSettingsModel,
  registerSyncOutboxModel,
  SyncOutbox,
  writeAuditLog,
  type SyncOutboxModelPort,
} from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

registerSyncOutboxModel(SyncOutbox as unknown as SyncOutboxModelPort);

const SELECT = 'defaultCommissionRate maxStoresPerSeller stripeCommissionNote settingsRevision createdAt updatedAt';
const NOT_RECORDED = 'The change could not be recorded and was not applied';
const NOT_UNDONE = 'The settings could not be recorded, and the change could not be put back. Check the settings before doing anything else.';
/** The platform settings are one document; the sync outbox addresses it by this id (the dispatcher's platform binding). */
const SYNC_ENTITY_ID = 'platform';

function settingsFilter(): never {
  return { globalType: SETTINGS_GLOBAL_TYPE } as never;
}

/**
 * GET /api/admin/settings. The platform settings (default commission rate, store limit per seller, Stripe commission
 * note) with the revision and the time of the last change. The platform settings document is never created here: if
 * the platform has none, the answer is a 404, not made-up defaults.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await authorizeAdmin(request);
    requirePolicy(() => assertCan('admin', 'read', 'platformSettings'));

    const found = (await PlatformSettingsModel.findOne(settingsFilter()).select(SELECT).lean()) as unknown as Doc | null;
    if (!found) throw new AdminHttpError(404, NOT_SET_UP_MESSAGE);
    return Response.json({ settings: toSettingsRow(found) }, { status: 200, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * PATCH /api/admin/settings. Changes the settings sent (an optional reason goes to the audit entry). The write is
 * conditional on the revision that was read, so two operators cannot both win (409), and it advances the revision. A
 * change to a setting the seller receives is queued for the seller. The change is audited with the values before and
 * after; if the audit entry or the queue write fails, the settings are put back and the call fails. If the put-back
 * itself fails, the response says so, and a compensating audit entry records the reversal that did not happen.
 */
export async function PATCH(request: Request): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request);
    requirePolicy(() => {
      assertCan('admin', 'update', 'platformSettings', SETTINGS_FIELDS);
      // The revision is moved by the server, never by the operator: that write runs as the system actor.
      assertCan('system', 'update', 'platformSettings');
      assertCan('system', 'create', 'sync-outbox');
    });

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw new AdminHttpError(400, 'Body must be JSON');
    }
    const input = parseSettingsUpdate(raw);
    if (!input.ok) return Response.json({ error: 'Invalid request', issues: input.issues }, { status: 422, headers: NO_STORE });
    const { changes, reason } = input.data;

    const found = (await PlatformSettingsModel.findOne(settingsFilter()).select(SELECT).lean()) as unknown as Doc | null;
    if (!found) throw new AdminHttpError(404, NOT_SET_UP_MESSAGE);
    const id = String(found._id);
    const before = toSettingsRow(found);

    // Compared with what is stored, not with the displayed values (a missing stored value shows its default).
    const changed = changedFieldsAgainstStored(found, changes);
    if (changed.length === 0) return Response.json({ settings: before, queued: null }, { status: 200, headers: NO_STORE });

    const applied = (await PlatformSettingsModel.findOneAndUpdate(
      revisionFilter(id, before.settingsRevision) as never,
      buildSettingsUpdate(changes, changed) as never,
      { new: true },
    )
      .select(SELECT)
      .lean()) as unknown as Doc | null;
    if (!applied) throw new AdminHttpError(409, CONFLICT_MESSAGE);
    const after = toSettingsRow(applied);

    let queued: { eventId: string; revision: number } | null = null;
    let auditWritten = false;
    try {
      await writeAuditLog('settings.update', 'platformSettings', id, userId, {
        reason,
        changed,
        before: settingsSnapshot(before),
        after: settingsSnapshot(after),
      });
      auditWritten = true;
      if (needsSync(changed)) {
        const event = await enqueueSyncEvent({
          target: 'seller',
          entity: 'platform',
          entityId: SYNC_ENTITY_ID,
          group: 'settings',
          payload: {
            defaultCommissionRate: after.defaultCommissionRate,
            maxStoresPerSeller: after.maxStoresPerSeller,
          },
        });
        queued = { eventId: event.eventId, revision: event.revision };
      }
    } catch (err) {
      const reverted = await PlatformSettingsModel.updateOne(
        revisionFilter(id, after.settingsRevision) as never,
        buildRevertUpdate(found, changed, before.settingsRevision) as never,
      ).then(
        (r) => r.matchedCount === 1,
        () => false,
      );
      if (auditWritten) {
        // Audit entries are immutable: the reversal is recorded as a new entry next to the update it undoes.
        await writeAuditLog('settings.update_rolled_back', 'platformSettings', id, userId, {
          reason,
          attempted: changed,
          restored: reverted,
          note: 'Not completed. The settings were ' + (reverted ? 'put back.' : 'NOT put back; check them before retrying.'),
        }).catch(() => undefined);
      }
      console.error('settings update rolled back:', err instanceof Error ? err.message : 'unknown error');
      throw new AdminHttpError(500, reverted ? NOT_RECORDED : NOT_UNDONE);
    }

    return Response.json({ settings: after, queued }, { status: 200, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
