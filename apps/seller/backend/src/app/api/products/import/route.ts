import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { PRODUCT_IMPORT_MAX_BYTES } from '@/lib/contracts';
import { resolveOwnedStoreId } from '@/lib/data-plane';
import { HttpError, jsonError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { runProductImport } from '@/lib/product-import';
import { ProductRequestError, handleProductError } from '@/lib/products';
import { assertCan } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Room for the multipart wrapping around a file at the limit. */
const MULTIPART_MARGIN = 64 * 1024;

const tooLarge = (): ProductRequestError => new ProductRequestError(413, 'IMPORT_FILE_TOO_LARGE', 'A file can be at most 2 MB.');

/**
 * POST /api/products/import. Multipart: file, and dryRun=true to validate without writing. The store is the owner's, and
 * the whole contract of the file is in lib/product-import.ts.
 *
 *   200 the report: created, updated, failed, and one entry per row
 *   413 IMPORT_FILE_TOO_LARGE   422 IMPORT_TOO_MANY_ROWS, IMPORT_BAD_FILE, all before anything is written
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    assertCan(ctx.actor, 'create', 'productBulk');
    if (Number(request.headers.get('content-length') ?? 0) > PRODUCT_IMPORT_MAX_BYTES + MULTIPART_MARGIN) throw tooLarge();

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof Blob)) return jsonError(422, 'file is required');
    if (file.size > PRODUCT_IMPORT_MAX_BYTES) throw tooLarge();

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    const storeId = await resolveOwnedStoreId(request, ctx, null);
    const report = await runProductImport(storeId, await file.text(), form?.get('dryRun') === 'true');
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleProductError(err);
  }
}
