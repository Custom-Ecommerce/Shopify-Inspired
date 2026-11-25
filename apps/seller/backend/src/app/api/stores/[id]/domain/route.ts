import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { DOMAIN_SELECT, domainStateOf, type DomainStoreDoc } from '@/lib/domain-routes';
import { handleRouteError } from '@/lib/http';
import { loadOwnedStore, requireSellerActor } from '@/lib/owned-store';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/stores/:id/domain (S7-B5): the domain page's data. Owner only; the token is seen only inside the TXT record, by the owner. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    assertCan(ctx.actor, 'read', 'stores', ['domain', 'customDomainStatus']);
    const { id } = await context.params;
    const doc = (await loadOwnedStore(request, ctx, id, DOMAIN_SELECT, 'settings.domain')) as unknown as DomainStoreDoc;
    return NextResponse.json(await domainStateOf(doc, ctx), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
