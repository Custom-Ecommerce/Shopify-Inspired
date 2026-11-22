import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { authLimiter, readAccountBody } from '@/lib/account-support';
import { domainVerifyRequestSchema } from '@/lib/contracts';
import { getDnsResolver } from '@/lib/domain-dns';
import { auditDomain, DOMAIN_SELECT, domainStateOf, type DomainStoreDoc } from '@/lib/domain-routes';
import { checkDomainDns, domainTargets, DOMAIN_VERIFY_RULE, type DomainFailureReason } from '@/lib/domain-service';
import { getVercelDomains } from '@/lib/domain-vercel';
import { HttpError, handleRouteError } from '@/lib/http';
import { loadOwnedStore, requireSellerActor } from '@/lib/owned-store';
import { assertCustomDomainAllowed } from '@/lib/plan';
import { revalidateStore } from '@/lib/revalidate';
import { assertCan, Store } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * POST /api/stores/:id/domain/verify (S7-B5, D-118). The body is empty: the check is made here, from live DNS, never from the client.
 *
 * Order: authenticate -> owner only -> parse -> assertCan -> DB -> id -> the seller's own store -> 409 DOMAIN_NOT_SET -> plan gate ->
 * rate limit (10 per store per hour, 429) -> DNS check -> (when right) the Vercel port -> ONE compare-and-set write -> re-read -> audit.
 *
 *   200 the domain state. A check that fails is data, not an error: status failed with a failureReason.
 *   A domain that is already verified keeps its state when a later check fails (a DNS hiccup must not take a live store down):
 *   the status stays verified and only checkedAt and failureReason are recorded.
 *   A domain becomes verified only after the Vercel add succeeded (or the stub is active); otherwise failed / vercel_failed.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    await readAccountBody(request, domainVerifyRequestSchema);
    assertCan(ctx.actor, 'update', 'stores', ['domain']);
    const { id } = await context.params;
    const current = (await loadOwnedStore(request, ctx, id, DOMAIN_SELECT)) as unknown as DomainStoreDoc;
    const storeId = String(current._id);

    const host = typeof current.domain === 'string' && current.domain !== '' ? current.domain : null;
    const token = typeof current.domainToken === 'string' && current.domainToken !== '' ? current.domainToken : null;
    if (host === null || token === null) throw new HttpError(409, 'Connect a domain first.', 'DOMAIN_NOT_SET', 'domain');

    await assertCustomDomainAllowed(ctx.userId);
    await authLimiter.consume(DOMAIN_VERIFY_RULE, storeId);

    const wasVerified = current.customDomainStatus === 'verified';
    const dns = await checkDomainDns(getDnsResolver(), host, token, domainTargets());
    let failure: DomainFailureReason | null = dns.ok ? null : dns.reason;
    if (dns.ok) {
      const added = await getVercelDomains().addDomain(host);
      if (!added.ok) failure = 'vercel_failed';
    }

    const now = new Date();
    const set: Record<string, unknown> = { domainCheckedAt: now };
    const unset: Record<string, ''> = {};
    if (failure === null) {
      set.customDomainStatus = 'verified';
      unset.domainFailureReason = '';
    } else {
      set.domainFailureReason = failure;
      // A live domain is not taken down by a failed re-check.
      set.customDomainStatus = wasVerified ? 'verified' : 'failed';
    }
    const updated = await Store.findOneAndUpdate(
      { _id: storeId, owner: ctx.userObjectId, domain: host, domainToken: token } as never,
      { $set: set, ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}) } as never,
      { new: true },
    )
      .select(DOMAIN_SELECT)
      .lean();
    if (!updated) throw new HttpError(409, 'The domain changed meanwhile. Reload and check again.');

    if (failure === null && !wasVerified) revalidateStore(storeId);
    await auditDomain(failure === null ? 'store.domain_verified' : 'store.domain_check_failed', storeId, ctx, { domain: host, reason: failure });
    return NextResponse.json(await domainStateOf(updated as DomainStoreDoc, ctx), { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
