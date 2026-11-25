import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ARTICLE_INVALID, ARTICLE_SLUG_TAKEN, ARTICLE_STATUSES, ARTICLE_TYPES, articleCreateSchema } from '@/lib/contracts';
import { authenticate, auditActorOf } from '@/lib/auth';
import { articleSlugFromTitle, articleToWire, parseArticleBody, resolveArticleMedia } from '@/lib/articles';
import { HttpError, handleRouteError, isDuplicateKeyError, jsonError, parseIntParam } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { revalidateStore } from '@/lib/revalidate';
import { assertCan, listEnvelope, StoreArticle, writeAuditLog } from '@/lib/services';
import { plainDoc } from '@/lib/seller-scope';
import { resolveOwnedStoreId } from '@/lib/data-plane';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SEARCH_MAX = 80;
const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function requireDatabase(): Promise<void> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
}

/**
 * GET /api/storeArticles. The store's articles, newest first, with optional status and type filters and (Sprint 7) a title search `q`. The list leaves
 * the text of each article out (GET /api/storeArticles/:id has it).
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'storeArticles');

    const params = request.nextUrl.searchParams;
    const status = params.get('status');
    const type = params.get('type');
    if (status !== null && !(ARTICLE_STATUSES as readonly string[]).includes(status)) {
      return jsonError(422, 'status must be draft, published, or archived');
    }
    if (type !== null && !(ARTICLE_TYPES as readonly string[]).includes(type)) {
      return jsonError(422, 'type must be blog, lookbook, size_guide, or care_instructions');
    }
    const search = (params.get('q') ?? '').trim().slice(0, SEARCH_MAX);
    const page = parseIntParam(params.get('page'), 1, 1, 100000);
    const limit = parseIntParam(params.get('limit'), 20, 1, 100);

    await requireDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null, { capability: 'content.read' });
    const filter: Record<string, unknown> = { store: storeId };
    if (status !== null) filter.status = status;
    if (type !== null) filter.type = type;
    if (search !== '') filter.title = { $regex: escapeRegex(search), $options: 'i' };

    const [rows, totalDocs] = await Promise.all([
      StoreArticle.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select('-content -mediaRefs').lean(),
      StoreArticle.countDocuments(filter),
    ]);
    const docs = (rows as unknown as Record<string, unknown>[]).map((row) => articleToWire(row, { withContent: false }));
    return NextResponse.json(listEnvelope(docs, { page, limit, totalDocs }), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/storeArticles (Sprint 7, S7-B2, CO-116). Writes a blog article for the verified store.
 *
 *   201 the article   400 ARTICLE_INVALID { field }   401   403 admin, or a store the seller does not own
 *   409 ARTICLE_SLUG_TAKEN   the web address is used by another article of this store
 *
 * Order: authenticate, role, parse, assertCan, DB, store (requireStore), pictures, slug, write, audit. The store, the revision (0), the publish date
 * (set when the article is created published) and the media references are the server's; the body cannot carry them (the contract is strict).
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    if (ctx.actor !== 'seller') throw new HttpError(403, 'Only the store owner can write articles');
    const body = await parseArticleBody(request, articleCreateSchema);
    assertCan(ctx.actor, 'create', 'storeArticles', Object.keys(body));
    await requireDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null, { requireStore: true, capability: 'content.write' });

    const slug = body.slug ?? articleSlugFromTitle(body.title);
    if (slug === '') throw new HttpError(400, 'Enter a web address for the article.', ARTICLE_INVALID, 'slug');
    const content = body.content ?? '';
    const media = await resolveArticleMedia(storeId, { cover: body.coverImage, keepCover: null, content });

    const taken = await StoreArticle.findOne({ store: storeId, slug }).select('_id').lean();
    if (taken) throw new HttpError(409, 'An article with this web address already exists in your store.', ARTICLE_SLUG_TAKEN, 'slug');

    const status = body.status ?? 'draft';
    const now = new Date();
    let created: unknown;
    try {
      created = await StoreArticle.create({
        store: storeId,
        type: 'blog',
        title: body.title,
        slug,
        excerpt: body.excerpt ? body.excerpt : null,
        content,
        coverImage: media.coverImage,
        status,
        publishedAt: status === 'published' ? now : null,
        tags: body.tags ?? [],
        seoTitle: body.seoTitle ? body.seoTitle : null,
        seoDescription: body.seoDescription ? body.seoDescription : null,
        revision: 0,
        mediaRefs: media.mediaRefs,
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw new HttpError(409, 'An article with this web address already exists in your store.', ARTICLE_SLUG_TAKEN, 'slug');
      throw err;
    }

    const wire = articleToWire(plainDoc(created));
    try {
      await writeAuditLog('article.create', 'storeArticle', String(wire.id), auditActorOf(ctx), { storeId, status, fields: Object.keys(body), at: now.toISOString() });
    } catch (err) {
      console.error('[seller-backend] could not write the article create audit entry', err instanceof Error ? err.message : 'unknown');
    }
    if (status === 'published') revalidateStore(storeId);
    return NextResponse.json(wire, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
