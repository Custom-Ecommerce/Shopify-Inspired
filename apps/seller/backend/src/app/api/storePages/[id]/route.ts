import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { PAGE_REVISION_CONFLICT, PAGE_SLUG_TAKEN, objectIdSchema, pageUpdateSchema } from '@/lib/contracts';
import { authenticate, auditActorOf } from '@/lib/auth';
import { assertPageSlugAllowed, pageToWire, parsePageBody, resolvePageMedia } from '@/lib/pages';
import { HttpError, handleRouteError, isDuplicateKeyError, jsonError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { revalidateStore } from '@/lib/revalidate';
import { assertCan, StorePage, writeAuditLog } from '@/lib/services';
import { resolveOwnedStoreId } from '@/lib/data-plane';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const notFound = (): HttpError => new HttpError(404, 'Page not found');
const slugTaken = (): HttpError => new HttpError(409, 'A page with this web address already exists in your store.', PAGE_SLUG_TAKEN, 'slug');

async function requireDatabase(): Promise<void> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
}

interface StoredPage {
  _id: unknown;
  slug?: unknown;
  status?: unknown;
  revision?: unknown;
  publishedAt?: unknown;
  body?: unknown;
}

/** GET /api/storePages/:id. Another store's page answers 404. */
export async function GET(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!objectIdSchema.safeParse(id).success) return jsonError(422, 'id must be a 24-character ObjectId');
    const ctx = await authenticate(request);
    if (ctx.actor !== 'seller') throw new HttpError(403, 'Only the store owner can manage pages');
    assertCan(ctx.actor, 'read', 'storePages');
    await requireDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null, { capability: 'content.read' });

    const doc = await StorePage.findOne({ _id: id, store: storeId }).lean();
    if (!doc) throw notFound();
    return NextResponse.json(pageToWire(doc), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * PATCH /api/storePages/:id (Sprint 7, S7-B3). Changes only the fields sent; `revision` (the version the form read) is required.
 *
 *   200 the page   400 PAGE_INVALID { field }   400 PAGE_SLUG_RESERVED   401   403   404 bad id, unknown, or another store's
 *   409 PAGE_SLUG_TAKEN   409 PAGE_REVISION_CONFLICT { currentRevision }
 *
 * Order: authenticate, role, parse, assertCan, DB, id, store (requireStore), findOne({ _id, store }), ONE compare-and-set write on the revision, re-read,
 * best-effort audit. publishedAt is set the FIRST time the page is published and kept after an unpublish. The storefront cache is purged when the page
 * is, or was, published.
 */
export async function PATCH(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    if (ctx.actor !== 'seller') throw new HttpError(403, 'Only the store owner can write pages');
    const { revision, ...changes } = await parsePageBody(request, pageUpdateSchema);
    assertCan(ctx.actor, 'update', 'storePages', Object.keys(changes));
    const { id } = await context.params;
    await requireDatabase();
    if (!mongoose.isValidObjectId(id)) throw notFound();
    const storeId = await resolveOwnedStoreId(request, ctx, null, { requireStore: true, capability: 'content.write' });

    const before = (await StorePage.findOne({ _id: id, store: storeId }).lean()) as unknown as StoredPage | null;
    if (!before) throw notFound();

    const set: Record<string, unknown> = {};
    if (changes.title !== undefined) set.title = changes.title;
    if (changes.showInFooter !== undefined) set.showInFooter = changes.showInFooter;
    if (changes.sortOrder !== undefined) set.sortOrder = changes.sortOrder;
    if (changes.body !== undefined) {
      set.body = changes.body;
      set.mediaRefs = await resolvePageMedia(storeId, changes.body);
    }
    if (changes.slug !== undefined && changes.slug !== before.slug) {
      assertPageSlugAllowed(changes.slug);
      const other = (await StorePage.findOne({ store: storeId, slug: changes.slug }).select('_id').lean()) as unknown as { _id: unknown } | null;
      if (other && String(other._id) !== id) throw slugTaken();
      set.slug = changes.slug;
    }
    const wasPublished = before.status === 'published';
    if (changes.status !== undefined) {
      set.status = changes.status;
      if (changes.status === 'published' && !before.publishedAt) set.publishedAt = new Date();
    }

    // ONE write, compare-and-set on the revision. A row from before revisions existed has none and reads as 0.
    let matched = 0;
    try {
      const written = (await StorePage.updateOne(
        { _id: id, store: storeId, revision: revision === 0 ? { $in: [0, null] } : revision },
        Object.keys(set).length > 0 ? { $set: set, $inc: { revision: 1 } } : { $inc: { revision: 1 } },
      )) as { matchedCount?: number; n?: number };
      matched = written.matchedCount ?? written.n ?? 0;
    } catch (err) {
      if (isDuplicateKeyError(err)) throw slugTaken();
      throw err;
    }

    const after = (await StorePage.findOne({ _id: id, store: storeId }).lean()) as unknown as StoredPage | null;
    if (matched === 0) {
      if (!after) throw notFound();
      const currentRevision = typeof after.revision === 'number' ? after.revision : 0;
      return NextResponse.json(
        { errors: [{ message: 'This page was changed somewhere else. Reload it, then make your change again.' }], code: PAGE_REVISION_CONFLICT, field: 'revision', currentRevision },
        { status: 409, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (!after) throw notFound();

    const isPublished = after.status === 'published';
    const action = changes.status !== undefined && changes.status !== before.status ? (isPublished ? 'page.publish' : 'page.unpublish') : 'page.update';
    try {
      await writeAuditLog(action, 'storePage', id, auditActorOf(ctx), { storeId, fields: Object.keys(changes), revision: revision + 1, at: new Date().toISOString() });
    } catch (err) {
      console.error('[seller-backend] could not write the page audit entry', err instanceof Error ? err.message : 'unknown');
    }
    if (wasPublished || isPublished) revalidateStore(storeId);
    return NextResponse.json(pageToWire(after), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** DELETE /api/storePages/:id (Sprint 7, S7-B3). 200 { deleted: true, id }; 401; 403; 404 bad id, unknown, or another store's. Purges the storefront cache when the page was published. */
export async function DELETE(request: NextRequest, context: Ctx): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    if (ctx.actor !== 'seller') throw new HttpError(403, 'Only the store owner can delete pages');
    assertCan(ctx.actor, 'delete', 'storePages');
    const { id } = await context.params;
    await requireDatabase();
    if (!mongoose.isValidObjectId(id)) throw notFound();
    const storeId = await resolveOwnedStoreId(request, ctx, null, { requireStore: true, capability: 'content.write' });

    const before = (await StorePage.findOne({ _id: id, store: storeId }).select('status').lean()) as unknown as StoredPage | null;
    if (!before) throw notFound();
    const removed = (await StorePage.deleteOne({ _id: id, store: storeId })) as { deletedCount?: number };
    if ((removed.deletedCount ?? 0) === 0) throw notFound();
    try {
      await writeAuditLog('page.delete', 'storePage', id, auditActorOf(ctx), { storeId, wasPublished: before.status === 'published', at: new Date().toISOString() });
    } catch (err) {
      console.error('[seller-backend] could not write the page delete audit entry', err instanceof Error ? err.message : 'unknown');
    }
    if (before.status === 'published') revalidateStore(storeId);
    return NextResponse.json({ deleted: true, id }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
