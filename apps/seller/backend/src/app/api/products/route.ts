import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { assertCan } from '@markaz/auth';
import { authenticate } from '@/lib/auth';
import { HttpError, handleRouteError, parseIntParam } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRODUCTS_COLLECTION = 'products';

/**
 * GET /api/products (placeholder)
 *
 * 'products' is not declared in POLICY_MATRIX yet, so assertCan() throws PolicyConfigError
 * and the route answers 501. Once the collection is declared and a Product model exists in
 * @markaz/db-schemas, replace the empty page below with a store-scoped query.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);

    assertCan(ctx.actor, 'read', PRODUCTS_COLLECTION);

    const params = request.nextUrl.searchParams;
    const limit = parseIntParam(params.get('limit'), 20, 1, 100);
    const page = parseIntParam(params.get('page'), 1, 1, 100000);

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });

    return NextResponse.json(
      { docs: [], totalDocs: 0, page, limit, totalPages: 1 },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/products (placeholder)
 *
 * Authenticates and checks policy, then reports that creation is not implemented. A denied
 * or undeclared collection never reaches the database.
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);

    assertCan(ctx.actor, 'create', PRODUCTS_COLLECTION);

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });

    throw new HttpError(501, 'Product creation is not implemented yet');
  } catch (err) {
    return handleRouteError(err);
  }
}
