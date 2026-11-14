/* patch_orders_fix: GET /api/stores/:id (replaces the placeholder) */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { SELLER_STORE_READABLE_FIELDS } from '@markaz/auth';
import { authenticate } from '@/lib/auth';
import { HttpError, handleRouteError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, Media, Store, writeAuditLog } from '@/lib/services';
import { plainDoc, toWire } from '@/lib/seller-scope';
import { readAccountBody } from '@/lib/account-support';
import { storeSettingsUpdateSchema } from '@/lib/contracts';
import { loadOwnedStore, requireSellerActor, SETTINGS_SELECT } from '@/lib/owned-store';
import { revalidateStore } from '@/lib/revalidate';
import { buildSettingsWrite, referencedMedia, settingsFieldsOf, SETTINGS_ERROR_CODE, toStoreSettings } from '@/lib/store-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/stores/:id. A seller reads only a store they own, projected to the fields the policy lets a
 * seller read; admins read the full document. A store that is not yours is a 404 (existence is not revealed).
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    const { id } = await context.params;

    const projection = ctx.actor === 'seller' ? [...SELLER_STORE_READABLE_FIELDS] : undefined;
    assertCan(ctx.actor, 'read', 'stores', projection);

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Store not found');

    const filter = ctx.actor === 'seller' ? { _id: id, owner: ctx.userObjectId } : { _id: id };
    const query = Store.findOne(filter);
    if (projection) query.select(projection.join(' '));
    const doc = await query.lean();
    if (!doc) throw new HttpError(404, 'Store not found');

    return NextResponse.json(toWire(plainDoc(doc)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * PATCH /api/stores/:id (Sprint 4 EP-04.US01-US05, D-094). The seller saves any part of the store settings: profile,
 * branding, social, SEO, delivery, payment methods, payout details and theme (contracts storeSettingsUpdateSchema).
 *
 * Order: authenticate -> owner only (an admin is refused) -> parse (400 with the field) -> assertCan on the top-level
 * fields written -> DB -> id -> the seller's own store -> the media named belong to the store -> ONE compare-and-set
 * write on updatedAt -> re-read -> revalidateStore() once -> audit (best effort; payout details as method and last 4 only).
 *
 *   200 the store settings (payout masked)   400 STORE_SETTINGS_INVALID | ACCOUNT_BODY_INVALID { field }
 *   401 no session   403 admin, or another seller's store   404 unknown store   409 changed meanwhile   503 database
 *
 * The slug is not in the schema: it cannot change after creation, and sending it is a 400 naming "slug".
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    const update = await readAccountBody(request, storeSettingsUpdateSchema);
    assertCan(ctx.actor, 'update', 'stores', settingsFieldsOf(update));
    const { id } = await context.params;
    const current = await loadOwnedStore(request, ctx, id, SETTINGS_SELECT);
    const storeId = String(current._id);

    const write = buildSettingsWrite(current, update);
    if (write.fields.length === 0) throw new HttpError(400, 'Change at least one setting.', SETTINGS_ERROR_CODE, 'body');

    for (const ref of referencedMedia(update)) {
      if (!(await Media.exists({ _id: ref.id, store: storeId }))) throw new HttpError(400, 'Upload the image to this store first.', SETTINGS_ERROR_CODE, ref.field);
    }

    const updated = await Store.findOneAndUpdate(
      { _id: storeId, owner: ctx.userObjectId, updatedAt: current.updatedAt ?? null },
      { $set: write.set },
      { new: true },
    )
      .select(SETTINGS_SELECT)
      .lean();
    if (!updated) throw new HttpError(409, 'The settings were changed in another tab. Reload and try again.');

    revalidateStore(storeId);
    try {
      await writeAuditLog('store.settings', 'store', storeId, 'seller:' + ctx.userId, {
        groups: write.groups,
        fields: write.fields,
        // Never the account number: the method and its last 4 characters only.
        ...(write.payoutChanged ? { payout: write.payoutSummary ?? { removed: true } } : {}),
        at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[seller-backend] could not write the store settings audit entry', err instanceof Error ? err.message : 'unknown');
    }
    return NextResponse.json({ settings: await toStoreSettings(updated as never) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}

