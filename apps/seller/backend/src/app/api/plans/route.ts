import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { handleRouteError, HttpError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { listPublicPlans } from '@/lib/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/plans (Sprint 6 EP-14.US01.T07, D-118): the active subscription plans, public fields only (key, name, priceRs in whole rupees,
 * interval, limits, features, sortOrder). Any signed-in seller may read them; they belong to no store. Plans are data an admin edits, so
 * nothing is cached.
 *
 *   200 { plans }   401 no session   403 an admin session   503 the database is unavailable
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    const plans = await listPublicPlans(ctx);
    return NextResponse.json({ plans }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
