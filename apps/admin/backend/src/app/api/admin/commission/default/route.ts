import { AdminHttpError, errorResponse } from '@/lib/admin-auth';
import { SETTINGS_GLOBAL_TYPE } from '@/lib/admin-commission';
import { parseRateChange } from '@/lib/admin-commission-rates';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import {
  CONFLICT_MESSAGE,
  NOT_SET_UP_MESSAGE,
  buildRevertUpdate,
  buildSettingsUpdate,
  changedFieldsAgainstStored,
  revisionFilter,
  syncPayload,
  toSettingsRow,
} from '@/lib/admin-settings';
import type { Doc } from '@/lib/admin-stores';
import {
  assertCan,
  CommissionRateHistory,
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

const SELECT = 'defaultCommissionRate maxStoresPerSeller storeApprovalRequired codCommissionPercent paymentInstructions graceDays trialDays supportEmail supportPhone settingsRevision updatedAt';
const FIELD = ['defaultCommissionRate'] as const;
/** The platform settings are one document; the sync outbox addresses it by this id (see /api/admin/settings). */
const SYNC_ENTITY_ID = 'platform';

const filter = (): never => ({ globalType: SETTINGS_GLOBAL_TYPE }) as never;

/** GET /api/admin/commission/default: the platform default commission rate. */
export async function GET(request: Request): Promise<Response> {
  try {
    await authorizeAdmin(request);
    requirePolicy(() => assertCan('admin', 'read', 'platformSettings'));
    const found = (await PlatformSettingsModel.findOne(filter()).select(SELECT).lean()) as unknown as Doc | null;
    if (!found) throw new AdminHttpError(404, NOT_SET_UP_MESSAGE);
    const row = toSettingsRow(found);
    return Response.json({ defaultRate: row.defaultCommissionRate, settingsRevision: row.settingsRevision }, { status: 200, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * PUT /api/admin/commission/default { rate, reason }: the platform default for GATEWAY (card) orders, 0 to 100, one decimal.
 * Cash on delivery has its own percent (codCommissionPercent, D-116). The same conditional write,
 * revision, audit and seller sync as PATCH /api/admin/settings, plus a history row. Applies to orders delivered or paid
 * after the change; no existing ledger entry is rewritten.
 */
export async function PUT(request: Request): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request);
    requirePolicy(() => {
      assertCan('admin', 'update', 'platformSettings', FIELD);
      assertCan('system', 'update', 'platformSettings');
      assertCan('system', 'create', 'sync-outbox');
    });

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw new AdminHttpError(400, 'Body must be JSON');
    }
    const input = parseRateChange(raw, 'set');
    if (!input.ok) return Response.json({ error: 'Invalid request', issues: input.issues }, { status: 422, headers: NO_STORE });
    const { rate, reason } = input.data;
    if (rate === null) throw new AdminHttpError(422, 'A rate is required');

    const found = (await PlatformSettingsModel.findOne(filter()).select(SELECT).lean()) as unknown as Doc | null;
    if (!found) throw new AdminHttpError(404, NOT_SET_UP_MESSAGE);
    const id = String(found._id);
    const before = toSettingsRow(found);
    const changes = { defaultCommissionRate: rate };
    const changed = changedFieldsAgainstStored(found, changes);
    if (changed.length === 0) return Response.json({ defaultRate: before.defaultCommissionRate, changed: false }, { status: 200, headers: NO_STORE });

    const applied = (await PlatformSettingsModel.findOneAndUpdate(revisionFilter(id, before.settingsRevision) as never, buildSettingsUpdate(changes, changed) as never, { new: true })
      .select(SELECT)
      .lean()) as unknown as Doc | null;
    if (!applied) throw new AdminHttpError(409, CONFLICT_MESSAGE);
    const after = toSettingsRow(applied);

    let queued: { eventId: string; revision: number } | null = null;
    let auditWritten = false;
    try {
      await CommissionRateHistory.create({
        scope: 'platform',
        store: null,
        actor: userId,
        oldMode: null,
        oldRate: before.defaultCommissionRate,
        newMode: null,
        newRate: rate,
        reason,
      } as never);
      await writeAuditLog('commission.default_rate_set', 'platformSettings', id, userId, {
        reason,
        before: { defaultCommissionRate: before.defaultCommissionRate },
        after: { defaultCommissionRate: after.defaultCommissionRate },
      });
      auditWritten = true;
      const event = await enqueueSyncEvent({
        target: 'seller',
        entity: 'platform',
        entityId: SYNC_ENTITY_ID,
        group: 'settings',
        payload: syncPayload(after),
      });
      queued = { eventId: event.eventId, revision: event.revision };
    } catch (err) {
      const reverted = await PlatformSettingsModel.updateOne(
        revisionFilter(id, after.settingsRevision) as never,
        buildRevertUpdate(found, changed, before.settingsRevision) as never,
      ).then(
        (r) => r.matchedCount === 1,
        () => false,
      );
      if (auditWritten) {
        await writeAuditLog('commission.default_rate_rolled_back', 'platformSettings', id, userId, { reason, restored: reverted }).catch(() => undefined);
      }
      await CommissionRateHistory.create({
        scope: 'platform',
        store: null,
        actor: userId,
        oldMode: null,
        oldRate: rate,
        newMode: null,
        newRate: before.defaultCommissionRate,
        reason: 'Not applied: the change could not be recorded. ' + (reverted ? 'Put back.' : 'NOT put back; check the settings.'),
      } as never).catch(() => undefined);
      console.error('default rate change rolled back:', err instanceof Error ? err.message : 'unknown error');
      throw new AdminHttpError(
        500,
        reverted ? 'The change could not be recorded and was not applied' : 'The settings could not be recorded, and the change could not be put back. Check the settings before doing anything else.',
      );
    }

    return Response.json({ defaultRate: after.defaultCommissionRate, changed: true, queued }, { status: 200, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
