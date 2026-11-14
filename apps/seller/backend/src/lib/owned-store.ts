import mongoose from 'mongoose';
import type { NextRequest } from 'next/server';
import type { AuthContext } from '@/lib/auth';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { Store } from '@/lib/services';
import type { StoreDoc } from '@/lib/store-settings';

/**
 * Sprint 4 EP-04: the store a settings route is about, in the standard order: DB -> id -> resolveOwnedStoreId (the
 * path id must be a store this seller owns: another seller's store is 403, D-095) -> findOne({ _id, owner }).
 * Only the owning seller acts on settings: an admin session is refused before anything is read.
 */
export function requireSellerActor(ctx: AuthContext): void {
  if (ctx.actor !== 'seller') throw new HttpError(403, 'Only the store owner can change its settings');
}

export async function loadOwnedStore(request: NextRequest, ctx: AuthContext, id: string, select: string): Promise<StoreDoc> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Store not found');
  const storeId = await resolveOwnedStoreId(request, ctx, { store: { equals: id } });
  const doc = (await Store.findOne({ _id: storeId, owner: ctx.userObjectId }).select(select).lean()) as unknown as StoreDoc | null;
  if (!doc) throw new HttpError(404, 'Store not found');
  return doc;
}

export const SETTINGS_SELECT = 'name slug status owner storefront paymentSettings +payoutDetails updatedAt';
