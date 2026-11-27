import type { NextRequest } from 'next/server';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { MOBILE_PAGE_DEFAULT, MOBILE_PAGE_MAX, mobileDatabase, mobileError, mobileJson, requireSellerApp, pageNumbers } from '@/lib/mobile-api';
import { stampOf } from '@/lib/mobile-revision';
import { readProductListPage } from '@/lib/product-list';
import { toSellerProductSummary } from '@/lib/products';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/mobile/v1/products?q=&status=&sort=&stock=&page=&limit= (x-store-id required). The portal's product list, at most 50 a page. */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await requireSellerApp(request);
    assertCan(ctx.actor, 'read', 'products');
    await mobileDatabase();
    const storeId = await resolveOwnedStoreId(request, ctx, null, { requireStore: true, capability: 'products.read' });
    const { rows, totalDocs, page, limit } = await readProductListPage(storeId, request.nextUrl.searchParams, { defaultLimit: MOBILE_PAGE_DEFAULT, maxLimit: MOBILE_PAGE_MAX });
    const docs = rows.map((row) => {
      const item = toSellerProductSummary(row);
      return {
        id: item.id,
        title: item.title,
        status: item.status,
        minPrice: item.minPrice,
        totalStock: item.totalStock,
        stockStatus: item.stockStatus,
        variantCount: item.variantCount,
        imageUrl: item.imageUrl,
        ...stampOf(row),
      };
    });
    return mobileJson({ docs, ...pageNumbers(totalDocs, page, limit) });
  } catch (err) {
    return mobileError(err);
  }
}
