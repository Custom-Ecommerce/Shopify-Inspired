import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { ARTICLE_REVISION_CONFLICT, ARTICLE_SLUG_TAKEN, articleUpdateSchema, objectIdSchema } from '@/lib/contracts';
import { authenticate } from '@/lib/auth';
import { articleContentText, articleToWire, parseArticleBody, resolveArticleMedia } from '@/lib/articles';
import { HttpError, handleRouteError, isDuplicateKeyError, jsonError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { revalidateStore } from '@/lib/revalidate';
import { assertCan, Media, StoreArticle, writeAuditLog } from '@/lib/services';
import { resolveOwnedStoreId } from '@/lib/data-plane';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const notFound = (): HttpError => new HttpError(404, 'Article not found');
const slugTaken = (): HttpError => new HttpError(409, 'An article with this web address already exists in your store.', ARTICLE_SLUG_TAKEN, 'slug');

async function requireDatabase(): Promise<void> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
}

interface StoredArticle {
  _id: unknown;
  slug?: unknown;
  status?: unknown;
  revision?: unknown;
  publishedAt?: unknown;
  coverImage?: unknown;
  content?: unknown;
}

/** GET /api/storeArticles/:id. Another store's article answers 404. The content comes back as text (older rich-text rows are read as paragraphs); `coverImageUrl` is the address of the cover. */
export async function GET(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!objectIdSchema.safeParse(id).success) return jsonError(422, 'id must be a 24-character ObjectId');
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'storeArticles');
    await requireDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const doc = await StoreArticle.findOne({ _id: id, store: storeId }).lean();
    if (!doc) throw notFound();
    const wire = articleToWire(doc);
    // The form shows the cover: its address comes with the article (a file of this store only).
    const cover = (doc as unknown as StoredArticle).coverImage;
    if (cover) {
      const file = (await Media.findOne({ _id: String(cover), store: storeId }).select('url').lean()) as unknown as { url?: unknown } | null;
      wire.coverImageUrl = typeof file?.url === 'string' ? file.url : null;
    }
    return NextResponse.json(wire, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * PATCH /api/storeArticles/:id (Sprint 7, S7-B2, CO-116). Changes only the fields sent; `revision` (the version the form read) is required.
 *
 *   200 the article   400 ARTICLE_INVALID { field }   401   403 admin, or a store the seller does not own   404 bad id, unknown, or another store's
 *   409 ARTICLE_SLUG_TAKEN   409 ARTICLE_REVISION_CONFLICT { currentRevision }   the article changed since the form read it: nothing is written
 *
 * Order: authenticate, role, parse, assertCan, DB, id, store (requireStore), findOne({ _id, store }), ONE compare-and-set write on the revision, re-read,
 * best-effort audit. publishedAt is set the FIRST time the article becomes published and kept after an unpublish. The storefront cache is purged when the
 * article is, or was, published.
 */
export async function PATCH(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    if (ctx.actor !== 'seller') throw new HttpError(403, 'Only the store owner can write articles');
    const { revision, ...changes } = await parseArticleBody(request, articleUpdateSchema);
    assertCan(ctx.actor, 'update', 'storeArticles', Object.keys(changes));
    const { id } = await context.params;
    await requireDatabase();
    if (!mongoose.isValidObjectId(id)) throw notFound();
    const storeId = await resolveOwnedStoreId(request, ctx, null, { requireStore: true });

    const before = (await StoreArticle.findOne({ _id: id, store: storeId }).lean()) as unknown as StoredArticle | null;
    if (!before) throw notFound();

    const set: Record<string, unknown> = {};
    if (changes.title !== undefined) set.title = changes.title;
    if (changes.type !== undefined) set.type = changes.type;
    if (changes.excerpt !== undefined) set.excerpt = changes.excerpt ? changes.excerpt : null;
    if (changes.content !== undefined) set.content = changes.content;
    if (changes.tags !== undefined) set.tags = changes.tags;
    if (changes.seoTitle !== undefined) set.seoTitle = changes.seoTitle ? changes.seoTitle : null;
    if (changes.seoDescription !== undefined) set.seoDescription = changes.seoDescription ? changes.seoDescription : null;

    if (changes.slug !== undefined && changes.slug !== before.slug) {
      const other = (await StoreArticle.findOne({ store: storeId, slug: changes.slug }).select('_id').lean()) as unknown as { _id: unknown } | null;
      if (other && String(other._id) !== id) throw slugTaken();
      set.slug = changes.slug;
    }

    const wasPublished = before.status === 'published';
    if (changes.status !== undefined) {
      set.status = changes.status;
      if (changes.status === 'published' && !before.publishedAt) set.publishedAt = new Date();
    }

    if (changes.content !== undefined || changes.coverImage !== undefined) {
      const media = await resolveArticleMedia(storeId, {
        cover: changes.coverImage,
        keepCover: before.coverImage ? String(before.coverImage) : null,
        content: changes.content ?? articleContentText(before.content),
      });
      set.coverImage = media.coverImage;
      set.mediaRefs = media.mediaRefs;
    }

    // ONE write, compare-and-set on the revision. A row from before revisions existed has none and reads as 0.
    let matched = 0;
    try {
      const written = (await StoreArticle.updateOne(
        { _id: id, store: storeId, revision: revision === 0 ? { $in: [0, null] } : revision },
        Object.keys(set).length > 0 ? { $set: set, $inc: { revision: 1 } } : { $inc: { revision: 1 } },
      )) as { matchedCount?: number; n?: number };
      matched = written.matchedCount ?? written.n ?? 0;
    } catch (err) {
      if (isDuplicateKeyError(err)) throw slugTaken();
      throw err;
    }

    const after = (await StoreArticle.findOne({ _id: id, store: storeId }).lean()) as unknown as StoredArticle | null;
    if (matched === 0) {
      if (!after) throw notFound();
      const currentRevision = typeof after.revision === 'number' ? after.revision : 0;
      return NextResponse.json(
        { errors: [{ message: 'This article was changed somewhere else. Reload it, then make your change again.' }], code: ARTICLE_REVISION_CONFLICT, field: 'revision', currentRevision },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (!after) throw notFound();

    const isPublished = after.status === 'published';
    const action = changes.status !== undefined && changes.status !== before.status ? (isPublished ? 'article.publish' : 'article.unpublish') : 'article.update';
    try {
      await writeAuditLog(action, 'storeArticle', id, 'seller:' + ctx.userId, { storeId, fields: Object.keys(changes), revision: revision + 1, at: new Date().toISOString() });
    } catch (err) {
      console.error('[seller-backend] could not write the article audit entry', err instanceof Error ? err.message : 'unknown');
    }
    if (wasPublished || isPublished) revalidateStore(storeId);
    return NextResponse.json(articleToWire(after), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * DELETE /api/storeArticles/:id (Sprint 7, S7-B2). Deletes one article of the verified store. 200 { deleted: true, id }; 401; 403; 404 bad id, unknown, or
 * another store's. The storefront cache is purged when the article was published. Its pictures stay in the media library (they are free again).
 */
export async function DELETE(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    if (ctx.actor !== 'seller') throw new HttpError(403, 'Only the store owner can delete articles');
    assertCan(ctx.actor, 'delete', 'storeArticles');
    const { id } = await context.params;
    await requireDatabase();
    if (!mongoose.isValidObjectId(id)) throw notFound();
    const storeId = await resolveOwnedStoreId(request, ctx, null, { requireStore: true });

    const before = (await StoreArticle.findOne({ _id: id, store: storeId }).select('status').lean()) as unknown as StoredArticle | null;
    if (!before) throw notFound();
    const removed = (await StoreArticle.deleteOne({ _id: id, store: storeId })) as { deletedCount?: number };
    if ((removed.deletedCount ?? 0) === 0) throw notFound();

    try {
      await writeAuditLog('article.delete', 'storeArticle', id, 'seller:' + ctx.userId, { storeId, wasPublished: before.status === 'published', at: new Date().toISOString() });
    } catch (err) {
      console.error('[seller-backend] could not write the article delete audit entry', err instanceof Error ? err.message : 'unknown');
    }
    if (before.status === 'published') revalidateStore(storeId);
    return NextResponse.json({ deleted: true, id }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
