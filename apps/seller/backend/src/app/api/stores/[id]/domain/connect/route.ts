import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { readAccountBody } from '@/lib/account-support';
import { domainConnectRequestSchema } from '@/lib/contracts';
import { auditDomain, DOMAIN_SELECT, domainStateOf, type DomainStoreDoc } from '@/lib/domain-routes';
import { newDomainToken } from '@/lib/domain-service';
import { getVercelDomains } from '@/lib/domain-vercel';
import { validateCustomDomain } from '@/lib/domain-validation';
import { HttpError, handleRouteError, isDuplicateKeyError } from '@/lib/http';
import { loadOwnedStore, requireSellerActor } from '@/lib/owned-store';
import { assertCustomDomainAllowed } from '@/lib/plan';
import { revalidateStore } from '@/lib/revalidate';
import { assertCan, Store } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

const taken = (): HttpError => new HttpError(409, 'This domain is already connected to another store.', 'DOMAIN_TAKEN', 'domain');

/**
 * POST /api/stores/:id/domain/connect (S7-B5, D-118). Body { domain }.
 *
 * Order: authenticate -> owner only -> parse (400 DOMAIN_INVALID | ACCOUNT_BODY_INVALID with the field) -> assertCan -> DB -> id -> the
 * seller's own store (foreign 403, unknown 404) -> plan gate (403 PLAN_LIMIT_REACHED, limitKind customDomain) -> the host is free ->
 * ONE compare-and-set write -> re-read -> revalidate -> audit.
 *
 *   200 { domain, customDomainStatus: pending, dnsRecords: [routing record, TXT ownership record], ... }
 *   409 DOMAIN_TAKEN (held by another store; whose is never said)   409 the store changed meanwhile   502 DOMAIN_REMOVE_FAILED
 *
 * Sending the same host again changes nothing. A different host resets the status to pending with a NEW token (and takes the old one
 * off Vercel first when it was verified).
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    const body = await readAccountBody(request, domainConnectRequestSchema);
    const checked = validateCustomDomain(body.domain);
    if (!checked.ok) throw new HttpError(400, checked.message, 'DOMAIN_INVALID', 'domain');
    const host = checked.host;
    assertCan(ctx.actor, 'update', 'stores', ['domain']);
    const { id } = await context.params;
    const current = (await loadOwnedStore(request, ctx, id, DOMAIN_SELECT)) as unknown as DomainStoreDoc;
    const storeId = String(current._id);

    await assertCustomDomainAllowed(ctx.userId);

    const previous = typeof current.domain === 'string' && current.domain !== '' ? current.domain : null;
    if (previous === host && current.customDomainStatus !== 'unset' && typeof current.domainToken === 'string' && current.domainToken !== '') {
      return NextResponse.json(await domainStateOf(current, ctx), { headers: NO_STORE });
    }

    // Duplicates in old data are tolerated: ANY other store holding the host is a holder.
    if (await Store.exists({ domain: host, _id: { $ne: storeId } } as never)) throw taken();

    if (previous !== null && previous !== host && current.customDomainStatus === 'verified') {
      const removed = await getVercelDomains().removeDomain(previous);
      if (!removed.ok) throw new HttpError(502, 'We could not release your old domain. Please try again.', 'DOMAIN_REMOVE_FAILED', 'domain');
    }

    let updated: unknown;
    try {
      updated = await Store.findOneAndUpdate(
        { _id: storeId, owner: ctx.userObjectId, domain: previous } as never,
        {
          $set: { domain: host, customDomainStatus: 'pending', domainToken: newDomainToken() },
          $unset: { domainCheckedAt: '', domainFailureReason: '' },
        } as never,
        { new: true },
      )
        .select(DOMAIN_SELECT)
        .lean();
    } catch (err) {
      if (isDuplicateKeyError(err)) throw taken();
      throw err;
    }
    if (!updated) throw new HttpError(409, 'The store changed meanwhile. Reload and try again.');

    revalidateStore(storeId);
    await auditDomain('store.domain_connect', storeId, ctx, { domain: host, previous });
    return NextResponse.json(await domainStateOf(updated as DomainStoreDoc, ctx), { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
