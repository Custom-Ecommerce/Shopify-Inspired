import type { NextRequest } from 'next/server';
import { mobileError, mobileJson, requireSellerApp } from '@/lib/mobile-api';
import { stampOf } from '@/lib/mobile-revision';
import { Store } from '@/lib/services';
import { loadWorkspace } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/v1/stores (EP-31.US03.T01): the stores the signed-in seller can work in (their own, and those where they are an active member), with the
 * role in each. Only readable stores are listed.   200 { stores }   401   403 not a seller
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await requireSellerApp(request);
    const workspace = await loadWorkspace(ctx);
    const ids = workspace.stores.map((store) => store.id);
    const rows = ids.length === 0 ? [] : ((await Store.find({ _id: { $in: ids } }).select('updatedAt createdAt').lean()) as unknown as Array<{ _id: unknown }>);
    const stamps = new Map(rows.map((row) => [String(row._id), stampOf(row)]));
    return mobileJson({
      stores: workspace.stores.map((store) => ({
        id: store.id,
        name: store.name,
        slug: store.slug,
        status: store.status,
        role: store.role,
        logoUrl: store.logoUrl,
        ...(stamps.get(store.id) ?? stampOf(null)),
      })),
    });
  } catch (err) {
    return mobileError(err);
  }
}
