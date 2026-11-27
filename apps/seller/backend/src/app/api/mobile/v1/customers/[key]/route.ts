import type { NextRequest } from 'next/server';
import { getCustomerDetail, requireCustomerKey } from '@/lib/customers';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError } from '@/lib/http';
import { mobileDatabase, mobileError, mobileJson, requireSellerApp } from '@/lib/mobile-api';
import { revisionOf } from '@/lib/mobile-revision';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/v1/customers/:key (x-store-id required): one customer of the store, as the website's customer page reads it (Sprint 9, EP-32.US02.T02).
 * :key is the `id` of a list row: the normalized phone, or the email of a customer with no phone. Read-only.
 *
 *   200   400 a key that is neither   401   403 a foreign store or a role without customers   404 no order of this store has that customer
 */
export async function GET(request: NextRequest, context: { params: Promise<{ key: string }> }): Promise<Response> {
  try {
    const ctx = await requireSellerApp(request);
    const key = requireCustomerKey((await context.params).key);
    assertCan(ctx.actor, 'read', 'customers');
    await mobileDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null, { requireStore: true, capability: 'customers.read' });
    const detail = await getCustomerDetail(storeId, key);
    if (detail === null) throw new HttpError(404, 'Customer not found');
    const lastOrderAt = detail.stats.lastOrderAt;
    return mobileJson({ ...detail, revision: revisionOf(lastOrderAt), updatedAt: lastOrderAt ?? new Date(0).toISOString() });
  } catch (err) {
    return mobileError(err);
  }
}
