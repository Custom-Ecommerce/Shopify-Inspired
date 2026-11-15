import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { HttpError, handleRouteError } from '@/lib/http';
import { loadOwnedStore, requireSellerActor, SETTINGS_SELECT } from '@/lib/owned-store';
import { notifyAdminStoreGoLive } from '@/lib/admin-go-live';
import { notifyStoreLive } from '@/lib/notifications';
import { readPlatformSettings } from '@/lib/platform-settings';
import { revalidateStore } from '@/lib/revalidate';
import { assertCan, Store, writeAuditLog } from '@/lib/services';
import { storeReadiness } from '@/lib/store-readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * POST /api/stores/:id/go-live (Sprint 4 EP-04.US06, D-094, D-095).
 *
 *   422 STORE_NOT_READY { missing: [...] }   unless every checklist item passes
 *   200 { status: 'active', waitingForApproval: false }   approval not required: live at once (compare-and-set on
 *       status pending), the storefront is revalidated
 *   200 { status: 'pending', waitingForApproval: true }   approval required: the request is recorded (goLiveRequestedAt)
 *       and the store stays pending until an admin activates it (POST /api/admin/stores/:id/status, unchanged)
 *   200 the same answer for a store that is already active   409 the status changed meanwhile, or the store is suspended
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    assertCan(ctx.actor, 'read', 'stores', ['name', 'storefront', 'paymentSettings', 'status']);
    const { id } = await context.params;
    const doc = await loadOwnedStore(request, ctx, id, SETTINGS_SELECT);
    const storeId = String(doc._id);

    if (doc.status === 'active') {
      return NextResponse.json({ status: 'active', waitingForApproval: false, message: 'Your store is live.' }, { headers: NO_STORE });
    }
    if (doc.status !== 'pending') throw new HttpError(409, 'This store cannot go live from its current status.', 'STORE_STATUS', 'status');

    const readiness = await storeReadiness(doc, ctx);
    if (!readiness.ready) {
      return NextResponse.json(
        { errors: [{ message: 'Finish the checklist first.' }], code: 'STORE_NOT_READY', missing: readiness.missing, items: readiness.items },
        { status: 422, headers: NO_STORE },
      );
    }

    const now = new Date();
    const waiting = (await readPlatformSettings()).storeApprovalRequired;
    // A repeat while the request is already waiting is a no-op: nothing is written and the admin console is not called again.
    if (waiting && (doc as { goLiveRequestedAt?: unknown }).goLiveRequestedAt) {
      return NextResponse.json({ status: 'pending', waitingForApproval: true, message: 'Thank you. Your store goes live as soon as our team approves it.' }, { headers: NO_STORE });
    }
    const updated = await Store.findOneAndUpdate(
      { _id: storeId, owner: ctx.userObjectId, status: 'pending' },
      waiting ? { $set: { goLiveRequestedAt: now } } : { $set: { status: 'active', statusChangedAt: now, goLiveRequestedAt: now } },
      { new: true },
    )
      .select('status')
      .lean();
    if (!updated) throw new HttpError(409, 'The store changed meanwhile. Reload and try again.');

    if (!waiting) {
      revalidateStore(storeId);
      notifyStoreLive(storeId);
    }
    notifyAdminStoreGoLive({ storeId, status: waiting ? 'pending' : 'active', goLiveRequestedAt: now.toISOString() });
    try {
      await writeAuditLog(waiting ? 'store.go_live_requested' : 'store.go_live', 'store', storeId, 'seller:' + ctx.userId, { at: now.toISOString() });
    } catch (err) {
      console.error('[seller-backend] could not write the go-live audit entry', err instanceof Error ? err.message : 'unknown');
    }
    return NextResponse.json(
      waiting
        ? { status: 'pending', waitingForApproval: true, message: 'Thank you. Your store goes live as soon as our team approves it.' }
        : { status: 'active', waitingForApproval: false, message: 'Your store is live.' },
      { headers: NO_STORE },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
