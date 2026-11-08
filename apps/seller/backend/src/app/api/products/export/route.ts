import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { exportProductsCsv, productCsvTemplate } from '@/lib/product-import';
import { handleProductError } from '@/lib/products';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="' + filename + '"',
      'Cache-Control': 'no-store',
    },
  });
}

/** GET /api/products/export. The owner's products not in trash, one row per variant. ?template=1 is the empty format. */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'read', 'productBulk');
    if (request.nextUrl.searchParams.get('template') === '1') return csvResponse(productCsvTemplate(), 'products-template.csv');

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    const storeId = await resolveOwnedStoreId(request, ctx, null);
    return csvResponse(await exportProductsCsv(storeId), 'products.csv');
  } catch (err) {
    return handleProductError(err);
  }
}
