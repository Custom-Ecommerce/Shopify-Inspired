import { AdminHttpError, errorResponse } from '@/lib/admin-auth';
import { SETTINGS_GLOBAL_TYPE } from '@/lib/admin-commission';
import { parseRateChange, toStoreRateView } from '@/lib/admin-commission-rates';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { isObjectId, type Doc } from '@/lib/admin-stores';
import { DEFAULT_COMMISSION_RATE } from '@/lib/admin-settings';
import {
  assertCan,
  CommissionRateHistory,
  enqueueSyncEvent,
  PlatformSettingsModel,
  registerSyncOutboxModel,
  Store,
  SyncOutbox,
  writeAuditLog,
  type SyncOutboxModelPort,
} from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

registerSyncOutboxModel(SyncOutbox as unknown as SyncOutboxModelPort);

const SELECT = 'name commissionMode commissionRate govRevision';
const RATE_FIELDS = ['commissionMode', 'commissionRate'] as const;
const NOT_RECORDED = 'The change could not be recorded and was not applied';

export interface RateRouteContext {
  params: Promise<{ id: string }>;
}

async function defaultRate(): Promise<number> {
  const settings = (await PlatformSettingsModel.findOne({ globalType: SETTINGS_GLOBAL_TYPE } as never).select('defaultCommissionRate').lean()) as unknown as Doc | null;
  const value = settings?.defaultCommissionRate;
  return typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_COMMISSION_RATE;
}

async function loadStore(id: string): Promise<Doc> {
  if (!isObjectId(id)) throw new AdminHttpError(404, 'Store not found');
  const found = (await Store.findById(id).select(SELECT).lean()) as unknown as Doc | null;
  if (!found) throw new AdminHttpError(404, 'Store not found');
  return found;
}

/** GET /api/admin/commission/stores/:id: the store's rate, its mode and the rate that applies to its next order. */
export async function GET(request: Request, context: RateRouteContext): Promise<Response> {
  try {
    await authorizeAdmin(request);
    requirePolicy(() => {
      assertCan('admin', 'read', 'stores');
      assertCan('admin', 'read', 'platformSettings');
    });
    const { id } = await context.params;
    const store = await loadStore(id);
    return Response.json({ rate: toStoreRateView(store, await defaultRate()) }, { status: 200, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Sets (rate given) or clears (rate null: back to the platform default) the store's custom rate. The write is conditional on
 * the governance revision that was read, so two operators cannot both win (409), and it advances the revision. It is then
 * recorded (history row, audit entry) and queued for the seller (store.governance: commissionMode, commissionRate); if a step
 * fails the store is put back and the call fails. The new rate applies to orders delivered or paid AFTER the change only:
 * nothing rewrites an existing ledger entry.
 */
async function change(request: Request, context: RateRouteContext, mode: 'set' | 'clear'): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request);
    requirePolicy(() => {
      assertCan('admin', 'update', 'stores', RATE_FIELDS);
      assertCan('system', 'create', 'sync-outbox');
    });
    const { id } = await context.params;

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw new AdminHttpError(400, 'Body must be JSON');
    }
    const input = parseRateChange(raw, mode);
    if (!input.ok) return Response.json({ error: 'Invalid request', issues: input.issues }, { status: 422, headers: NO_STORE });
    const { rate, reason } = input.data;

    const found = await loadStore(id);
    const before = toStoreRateView(found, 0);
    const revisionBefore = typeof found.govRevision === 'number' ? found.govRevision : 0;
    const newMode = rate === null ? 'inherit' : 'custom';
    const newRate = rate ?? 0;
    if (before.mode === newMode && (newMode === 'inherit' || before.customRate === newRate)) {
      return Response.json({ rate: toStoreRateView(found, await defaultRate()), changed: false }, { status: 200, headers: NO_STORE });
    }

    const applied = await Store.updateOne(
      { _id: id, govRevision: revisionBefore === 0 ? { $in: [0, null] } : revisionBefore } as never,
      { $set: { commissionMode: newMode, commissionRate: newRate }, $inc: { govRevision: 1 } } as never,
    );
    if (applied.matchedCount === 0) throw new AdminHttpError(409, 'The store was changed by someone else. Reload and try again.');

    let queued: { eventId: string; revision: number } | null = null;
    try {
      await CommissionRateHistory.create({
        scope: 'store',
        store: id,
        actor: userId,
        oldMode: before.mode,
        oldRate: before.customRate,
        newMode,
        newRate: rate,
        reason,
      } as never);
      await writeAuditLog(rate === null ? 'commission.store_rate_cleared' : 'commission.store_rate_set', 'store', id, userId, {
        reason,
        before: { mode: before.mode, rate: before.customRate },
        after: { mode: newMode, rate },
      });
      const event = await enqueueSyncEvent({
        target: 'seller',
        entity: 'store',
        entityId: id,
        group: 'governance',
        payload: { commissionMode: newMode, commissionRate: newRate },
      });
      queued = { eventId: event.eventId, revision: event.revision };
    } catch (err) {
      console.error('store rate change failed:', err instanceof Error ? err.message : 'unknown error');
      const restored = await Store.updateOne(
        { _id: id, govRevision: revisionBefore + 1 } as never,
        {
          $set: { commissionMode: found.commissionMode === 'custom' ? 'custom' : 'inherit', commissionRate: typeof found.commissionRate === 'number' ? found.commissionRate : 0, govRevision: revisionBefore },
        } as never,
      ).then(
        (r) => r.matchedCount === 1,
        () => false,
      );
      await CommissionRateHistory.create({
        scope: 'store',
        store: id,
        actor: userId,
        oldMode: newMode,
        oldRate: rate,
        newMode: before.mode,
        newRate: before.customRate,
        reason: 'Not applied: the change could not be recorded. ' + (restored ? 'Put back.' : 'NOT put back; check the store.'),
      } as never).catch(() => undefined);
      throw new AdminHttpError(500, restored ? NOT_RECORDED : 'The change could not be recorded, and the store could not be restored. Check the store before doing anything else.');
    }

    const stored = await Store.findById(id).select(SELECT).lean();
    return Response.json({ rate: toStoreRateView((stored as unknown as Doc | null) ?? { ...found, commissionMode: newMode, commissionRate: newRate }, await defaultRate()), changed: true, queued }, { status: 200, headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}

/** PUT /api/admin/commission/stores/:id { rate, reason }: a custom rate, 0 to 100, one decimal. */
export function PUT(request: Request, context: RateRouteContext): Promise<Response> {
  return change(request, context, 'set');
}

/** DELETE /api/admin/commission/stores/:id { reason }: the store follows the platform default again. */
export function DELETE(request: Request, context: RateRouteContext): Promise<Response> {
  return change(request, context, 'clear');
}

