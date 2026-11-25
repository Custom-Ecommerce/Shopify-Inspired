/* patch_orders_fix: GET /api/stores/:id (replaces the placeholder) */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { authenticate, auditActorOf } from '@/lib/auth';
import { HttpError, handleRouteError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, Media, SELLER_STORE_READABLE_FIELDS, settingsGroupCapabilities, Store, writeAuditLog } from '@/lib/services';
import { plainDoc, toWire } from '@/lib/seller-scope';
import { readAccountBody } from '@/lib/account-support';
import { storeSettingsUpdateSchema } from '@/lib/contracts';
import { loadStoreFor, requireSellerActor, SETTINGS_SELECT } from '@/lib/owned-store';
import { revalidateStore } from '@/lib/revalidate';
import { assertThemeAllowedByPlan } from '@/lib/theme-plan';
import { buildSettingsWrite, effectiveTheme, referencedMedia, settingsFieldsOf, settingsForRole, SETTINGS_ERROR_CODE, storeDocForRole, toStoreSettings } from '@/lib/store-settings';
import { resolveStoreAccess } from '@/lib/data-plane';

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

    // S8-B3: the owner as always (the owner filter, the whole seller projection); an ACTIVE member of any role (capability store.view) reads the same store WITHOUT the payment and
    // courier settings (paymentSettings holds the fraud rules and the payment switches: owner business only). An admin reads the full document.
    let readable = projection;
    let filter: Record<string, unknown> = { _id: id };
    let role: Parameters<typeof storeDocForRole>[1] = null;
    if (ctx.actor === 'seller') {
      const access = await resolveStoreAccess(request, ctx, { store: { equals: id } }, { capability: 'store.view' });
      role = access.role;
      filter = access.isOwner ? { _id: id, owner: ctx.userObjectId } : { _id: id };
      if (!access.isOwner) readable = (projection ?? []).filter((field) => field !== 'paymentSettings' && field !== 'courierSettings') as typeof projection;
    }
    const query = Store.findOne(filter);
    if (readable) query.select(readable.join(' '));
    const doc = await query.lean();
    if (!doc) throw new HttpError(404, 'Store not found');

    return NextResponse.json(storeDocForRole(toWire(plainDoc(doc)) as Record<string, unknown>, role), { headers: { 'Cache-Control': 'no-store' } });
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
 *   422 CARD_CHECKOUT_UNSUPPORTED_BY_THEME (COD off on a theme without card checkout, or a switch to one while COD is off)
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
    // S8-B2 (D-118): the OWNER, or an active member whose role has the capability of EVERY group sent (tax: owner and manager; payments, fraud, domain, payout: the owner only;
    // the other groups: owner and manager). Staff and support have none. Anyone else is 403.
    const { doc: current, role } = await loadStoreFor(request, ctx, id, SETTINGS_SELECT, settingsGroupCapabilities(Object.keys(update)));
    const storeId = String(current._id);
    // The plan is the OWNER's, whoever saves.
    const ownerId = current.owner ? String(current.owner) : ctx.userId;

    // S7-B7 (D-118): a premium theme needs a plan with premium themes (after the ownership checks, only when the theme CHANGES).
    if (update.theme && update.theme.activeTheme !== effectiveTheme(current.storefront)) await assertThemeAllowedByPlan(ownerId, update.theme.activeTheme);

    const write = buildSettingsWrite(current, update);
    if (write.fields.length === 0) throw new HttpError(400, 'Change at least one setting.', SETTINGS_ERROR_CODE, 'body');

    for (const ref of referencedMedia(update)) {
      const filter = ref.imageOnly ? { _id: ref.id, store: storeId, resourceType: { $ne: 'video' } } : { _id: ref.id, store: storeId };
      if (!(await Media.exists(filter as never))) throw new HttpError(ref.status ?? 400, ref.message ?? 'Upload the image to this store first.', ref.code ?? SETTINGS_ERROR_CODE, ref.field);
    }

    const updated = await Store.findOneAndUpdate(
      { _id: storeId, owner: current.owner ?? ctx.userObjectId, updatedAt: current.updatedAt ?? null },
      { $set: write.set },
      { new: true },
    )
      .select(SETTINGS_SELECT)
      .lean();
    if (!updated) throw new HttpError(409, 'The settings were changed in another tab. Reload and try again.');

    revalidateStore(storeId);
    try {
      await writeAuditLog('store.settings', 'store', storeId, auditActorOf(ctx), {
        groups: write.groups,
        // S8-B2: who saved and in what role (the owner or a manager).
        actorRole: role,
        fields: write.fields,
        // Never the account number: the method and its last 4 characters only.
        ...(write.payoutChanged ? { payout: write.payoutSummary ?? { removed: true } } : {}),
        at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[seller-backend] could not write the store settings audit entry', err instanceof Error ? err.message : 'unknown');
    }
    // What the role may see of the saved settings: a manager never reads the payout account back, not even masked (settingsForRole).
    return NextResponse.json({ settings: settingsForRole(await toStoreSettings(updated as never), role) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}

