import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import type { SellerCapability } from '@markaz/auth';
import type { SellerReview } from '@markaz/contracts';
import { readAccountBody } from '@/lib/account-support';
import { authenticate, auditActorOf } from '@/lib/auth';
import { REVIEW_ALREADY_REPLIED, REVIEW_NOT_REPLIED, reviewReplyRequestSchema } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { revalidateStoreProduct } from '@/lib/revalidate';
import { productsOf, toSellerReview } from '@/lib/reviews';
import { Review, assertCan, writeAuditLog } from '@/lib/services';

type Row = Record<string, unknown>;

/**
 * Sprint 5 EP-21.US02.T01 (D-108): the seller's one reply to a review, written once (POST) and editable (PATCH). The seller keeps this and
 * nothing else of a review: the status is the admin's. Order: authenticate -> seller only -> parse the body (400 with the field) -> assertCan
 * -> DB -> id -> resolveOwnedStoreId -> findOne({ _id, store }) -> ONE compare-and-set write -> the re-read the write returns -> best-effort
 * audit (ids only: never the text). A foreign store id is 403, a foreign (or unknown) review id is 404.
 *
 *   create  POST  filter { _id, store, reply: null }       409 REVIEW_ALREADY_REPLIED when a reply exists (also the loser of two parallel posts)
 *   edit    PATCH filter { _id, store, reply: { $ne: null } } 409 REVIEW_NOT_REPLIED when there is nothing to edit yet
 */
export async function saveReply(request: NextRequest, id: string, mode: 'create' | 'edit', capability: SellerCapability): Promise<SellerReview> {
  const ctx = await authenticate(request);
  if (ctx.actor !== 'seller') throw new HttpError(403, 'Only the store owner can reply to a review');
  const { reply } = await readAccountBody(request, reviewReplyRequestSchema);
  assertCan(ctx.actor, 'update', 'reviews', ['reply']);
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Review not found');
  const storeId = await resolveOwnedStoreId(request, ctx, null, { capability });

  const current = (await Review.findOne({ _id: id, store: storeId }).lean()) as unknown as Row | null;
  if (!current) throw new HttpError(404, 'Review not found');
  const replied = typeof (current.reply as Row | null | undefined)?.text === 'string';
  if (mode === 'create' && replied) throw new HttpError(409, 'You already replied to this review. Edit your reply instead.', REVIEW_ALREADY_REPLIED);
  if (mode === 'edit' && !replied) throw new HttpError(409, 'There is no reply to edit yet.', REVIEW_NOT_REPLIED);

  const now = new Date();
  const updated = (await (mode === 'create'
    ? Review.findOneAndUpdate({ _id: id, store: storeId, reply: null }, { $set: { reply: { text: reply, at: now, editedAt: null } } }, { new: true })
    : Review.findOneAndUpdate({ _id: id, store: storeId, reply: { $ne: null } }, { $set: { 'reply.text': reply, 'reply.editedAt': now } }, { new: true })
  ).lean()) as unknown as Row | null;
  if (!updated) {
    // Lost a race: a parallel reply (or, for an edit, a removal) landed between the read and the write.
    if (mode === 'create') throw new HttpError(409, 'You already replied to this review. Edit your reply instead.', REVIEW_ALREADY_REPLIED);
    throw new HttpError(409, 'There is no reply to edit yet.', REVIEW_NOT_REPLIED);
  }

  revalidateStoreProduct(String(storeId), String(updated.product));
  try {
    await writeAuditLog(mode === 'create' ? 'review.reply' : 'review.reply_edit', 'review', id, auditActorOf(ctx), {
      storeId: String(storeId),
      reviewId: id,
      productId: String(updated.product),
      at: now.toISOString(),
    });
  } catch (err) {
    console.error('[seller-backend] could not write the review reply audit entry', err instanceof Error ? err.name : 'unknown');
  }
  const products = await productsOf([updated]);
  return toSellerReview(updated, products.get(String(updated.product)) ?? null);
}
