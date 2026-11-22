import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { auditDomain, DOMAIN_SELECT, domainStateOf, type DomainStoreDoc } from '@/lib/domain-routes';
import { getVercelDomains } from '@/lib/domain-vercel';
import { HttpError, handleRouteError } from '@/lib/http';
import { loadOwnedStore, requireSellerActor } from '@/lib/owned-store';
import { revalidateStore } from '@/lib/revalidate';
import { assertCan, Store } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * POST /api/stores/:id/domain/disconnect (S7-B5, D-118). No body. Never plan-gated: a seller who lost the feature can always leave.
 *
 * Order: authenticate -> owner only -> assertCan -> DB -> id -> the seller's own store -> the Vercel port removes the host -> ONE
 * compare-and-set write that clears domain, status, token, checkedAt and failureReason -> revalidate -> audit.
 *
 *   200 the empty domain state (also for a store with no domain: nothing is written)
 *   502 DOMAIN_REMOVE_FAILED  Vercel refused the removal; the store keeps its domain so the seller can try again
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    assertCan(ctx.actor, 'update', 'stores', ['domain']);
    const { id } = await context.params;
    const current = (await loadOwnedStore(request, ctx, id, DOMAIN_SELECT)) as unknown as DomainStoreDoc;
    const storeId = String(current._id);

    const host = typeof current.domain === 'string' && current.domain !== '' ? current.domain : null;
    if (host === null) return NextResponse.json(await domainStateOf(current, ctx), { headers: NO_STORE });

    const removed = await getVercelDomains().removeDomain(host);
    if (!removed.ok) throw new HttpError(502, 'We could not switch your domain off. Please try again.', 'DOMAIN_REMOVE_FAILED', 'domain');

    const updated = await Store.findOneAndUpdate(
      { _id: storeId, owner: ctx.userObjectId, domain: host } as never,
      { $set: { customDomainStatus: 'unset' }, $unset: { domain: '', domainToken: '', domainCheckedAt: '', domainFailureReason: '' } } as never,
      { new: true },
    )
      .select(DOMAIN_SELECT)
      .lean();
    if (!updated) throw new HttpError(409, 'The domain changed meanwhile. Reload and try again.');

    revalidateStore(storeId);
    await auditDomain('store.domain_disconnect', storeId, ctx, { domain: host });
    return NextResponse.json(await domainStateOf(updated as DomainStoreDoc, ctx), { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
