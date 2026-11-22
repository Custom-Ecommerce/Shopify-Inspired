import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { PAGE_INVALID, PAGE_SLUG_TAKEN, pageCreateSchema } from '@/lib/contracts';
import { authenticate } from '@/lib/auth';
import { articleSlugFromTitle } from '@/lib/articles';
import { assertPageSlugAllowed, pageToWire, parsePageBody, resolvePageMedia, templateCatalog } from '@/lib/pages';
import { HttpError, handleRouteError, isDuplicateKeyError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { revalidateStore } from '@/lib/revalidate';
import { assertCan, StorePage, writeAuditLog } from '@/lib/services';
import { plainDoc } from '@/lib/seller-scope';
import { resolveOwnedStoreId } from '@/lib/data-plane';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireDatabase(): Promise<void> {
  await connectSellerDb().catch(() => {
    throw new HttpError(503, 'Seller database unavailable');
  });
}

const slugTaken = (): HttpError => new HttpError(409, 'A page with this web address already exists in your store.', PAGE_SLUG_TAKEN, 'slug');

/**
 * GET /api/storePages (Sprint 7, S7-B3). The pages of the verified store in footer order, without their text, and the catalogue of default page templates
 * with whether each already exists. Reading this CREATES NOTHING: default pages are made only when the seller asks (POST /api/storePages/from-template).
 *
 *   200 { docs, totalDocs, templates: [{ key, slug, title, legal, showInFooter, exists }] }   401   403 an admin, or a store the seller does not own
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    if (ctx.actor !== 'seller') throw new HttpError(403, 'Only the store owner can manage pages');
    assertCan(ctx.actor, 'read', 'storePages');
    await requireDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null);

    const rows = (await StorePage.find({ store: storeId }).sort({ sortOrder: 1, title: 1 }).limit(200).lean()) as unknown as Array<Record<string, unknown>>;
    const docs = rows.map((row) => pageToWire(row, { withBody: false }));
    return NextResponse.json(
      { docs, totalDocs: docs.length, templates: templateCatalog(docs.map((doc) => String(doc.slug))) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/storePages (Sprint 7, S7-B3). Writes a page of the verified store from scratch (a draft unless the body says published).
 *
 *   201 the page   400 PAGE_INVALID { field }   400 PAGE_SLUG_RESERVED   401   403   409 PAGE_SLUG_TAKEN
 *
 * Order: authenticate, role, parse, assertCan, DB, store (requireStore), slug, pictures, write, audit.
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    if (ctx.actor !== 'seller') throw new HttpError(403, 'Only the store owner can write pages');
    const body = await parsePageBody(request, pageCreateSchema);
    assertCan(ctx.actor, 'create', 'storePages', Object.keys(body));
    await requireDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null, { requireStore: true });

    const slug = body.slug ?? articleSlugFromTitle(body.title);
    if (slug === '') throw new HttpError(400, 'Enter a web address for the page.', PAGE_INVALID, 'slug');
    assertPageSlugAllowed(slug);
    const text = body.body ?? '';
    const mediaRefs = await resolvePageMedia(storeId, text);
    if (await StorePage.findOne({ store: storeId, slug }).select('_id').lean()) throw slugTaken();

    const status = body.status ?? 'draft';
    const now = new Date();
    let created: unknown;
    try {
      created = await StorePage.create({
        store: storeId,
        title: body.title,
        slug,
        body: text,
        status,
        showInFooter: body.showInFooter ?? false,
        sortOrder: body.sortOrder ?? 0,
        revision: 0,
        mediaRefs,
        publishedAt: status === 'published' ? now : null,
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw slugTaken();
      throw err;
    }
    const wire = pageToWire(plainDoc(created));
    try {
      await writeAuditLog('page.create', 'storePage', String(wire.id), 'seller:' + ctx.userId, { storeId, slug, status, at: now.toISOString() });
    } catch (err) {
      console.error('[seller-backend] could not write the page create audit entry', err instanceof Error ? err.message : 'unknown');
    }
    if (status === 'published') revalidateStore(storeId);
    return NextResponse.json(wire, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
