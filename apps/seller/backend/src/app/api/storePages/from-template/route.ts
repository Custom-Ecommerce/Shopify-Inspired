import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as templatesNs from '@markaz/platform-kit/page-templates';
import { unwrapCjs } from '@/lib/cjs';
import { PAGE_SLUG_TAKEN, PAGE_TEMPLATE_UNKNOWN, pageFromTemplateSchema } from '@/lib/contracts';
import { authenticate, auditActorOf } from '@/lib/auth';
import { pageToWire, parsePageBody } from '@/lib/pages';
import { HttpError, handleRouteError, isDuplicateKeyError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { assertCan, StorePage, writeAuditLog } from '@/lib/services';
import { plainDoc } from '@/lib/seller-scope';
import { resolveOwnedStoreId } from '@/lib/data-plane';

const templates: typeof templatesNs = unwrapCjs(templatesNs);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const slugTaken = (): HttpError => new HttpError(409, 'You already have a page at this web address.', PAGE_SLUG_TAKEN, 'template');

/**
 * POST /api/storePages/from-template (Sprint 7, S7-B3). Creates ONE default page (about, contact, shipping, returns or privacy) from the platform's editable
 * template, as a DRAFT the seller then edits. Nothing is created behind the seller's back: this is the only way a default page comes to exist.
 *
 *   201 the page   400 PAGE_INVALID { field: template }   400 PAGE_TEMPLATE_UNKNOWN   401   403   409 PAGE_SLUG_TAKEN (the store has that page already)
 *
 * Order: authenticate, role, parse, assertCan, DB, store (requireStore), write, audit. The page is a draft, so nothing a shopper sees changes.
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    if (ctx.actor !== 'seller') throw new HttpError(403, 'Only the store owner can write pages');
    const body = await parsePageBody(request, pageFromTemplateSchema);
    assertCan(ctx.actor, 'create', 'storePages', ['title', 'slug', 'body', 'showInFooter', 'sortOrder']);
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    const storeId = await resolveOwnedStoreId(request, ctx, null, { requireStore: true, capability: 'content.write' });

    const template = templates.getPageTemplate(body.template);
    if (template === undefined) throw new HttpError(400, 'There is no template called "' + body.template.slice(0, 40) + '".', PAGE_TEMPLATE_UNKNOWN, 'template');
    if (await StorePage.findOne({ store: storeId, slug: template.slug }).select('_id').lean()) throw slugTaken();

    let created: unknown;
    try {
      created = await StorePage.create({
        store: storeId,
        title: template.title,
        slug: template.slug,
        body: template.body,
        status: 'draft',
        showInFooter: template.showInFooter,
        sortOrder: templates.PAGE_TEMPLATES.findIndex((t) => t.key === template.key) * 10,
        revision: 0,
        mediaRefs: [],
        template: template.key,
        publishedAt: null,
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw slugTaken();
      throw err;
    }
    const wire = pageToWire(plainDoc(created));
    try {
      await writeAuditLog('page.create', 'storePage', String(wire.id), auditActorOf(ctx), { storeId, slug: template.slug, template: template.key, status: 'draft', at: new Date().toISOString() });
    } catch (err) {
      console.error('[seller-backend] could not write the page create audit entry', err instanceof Error ? err.message : 'unknown');
    }
    return NextResponse.json(wire, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
