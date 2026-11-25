import mongoose from 'mongoose';
import type { NextRequest } from 'next/server';
import type { AuthContext } from '@/lib/auth';
import type { SellerCapability, SellerRole } from '@markaz/auth';
import { resolveStoreAccess } from '@/lib/data-plane';
import { TEAM_ERROR_CODES } from '@/lib/contracts';
import { HttpError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { sellerCan, Store } from '@/lib/services';
import type { StoreDoc } from '@/lib/store-settings';

/**
 * Sprint 4 EP-04: the store a settings route is about, in the standard order: DB -> id -> resolveOwnedStoreId (the
 * path id must be a store this seller owns: another seller's store is 403, D-095) -> findOne({ _id, owner }).
 * Only the owning seller acts on settings: an admin session is refused before anything is read.
 */
export function requireSellerActor(ctx: AuthContext): void {
  if (ctx.actor !== 'seller') throw new HttpError(403, 'Only the store owner can change its settings');
}

export async function loadOwnedStore(request: NextRequest, ctx: AuthContext, id: string, select: string, capability?: SellerCapability): Promise<StoreDoc> {
  // S8-B3: with a capability the OWNER and an ACTIVE member whose role has it pass; without one the route is owner-only (a member is refused 403 NOT_OWNER_YET).
  return (await loadStoreFor(request, ctx, id, select, capability === undefined ? [] : [capability])).doc;
}

/**
 * Sprint 8 (S8-B2, D-118): the store a route is about for the OWNER or an ACTIVE MEMBER whose role has every capability the route needs. Same order as loadOwnedStore (DB ->
 * id -> access -> read): a stranger, an invited, disabled or removed member is 403 as always; a member without a capability is 403 CAPABILITY_DENIED. The first
 * capability goes to the resolver (a member is refused without one: the safe default); the rest are checked against the role it answers.
 */
export async function loadStoreFor(
  request: NextRequest,
  ctx: AuthContext,
  id: string,
  select: string,
  capabilities: readonly SellerCapability[],
): Promise<{ doc: StoreDoc; role: SellerRole }> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Store not found');
  const [first, ...rest] = capabilities;
  const access = await resolveStoreAccess(request, ctx, { store: { equals: id } }, first === undefined ? {} : { capability: first });
  for (const capability of rest) {
    if (!sellerCan(access.role, capability)) throw new HttpError(403, 'Your role in this store cannot do that.', TEAM_ERROR_CODES.CAPABILITY_DENIED);
  }
  // An admin session names no role: it never reads a seller's store through here (as before: the owner filter found nothing).
  if (access.role === null) throw new HttpError(404, 'Store not found');
  // The owner is read through the owner filter as always; a member (access already checked above) by the store id alone.
  const filter = access.isOwner ? { _id: access.storeId, owner: ctx.userObjectId } : { _id: access.storeId };
  const doc = (await Store.findOne(filter).select(select).lean()) as unknown as StoreDoc | null;
  if (!doc) throw new HttpError(404, 'Store not found');
  return { doc, role: access.role };
}

export const SETTINGS_SELECT = 'name slug status owner storefront paymentSettings +payoutDetails goLiveRequestedAt domain customDomainStatus updatedAt';
