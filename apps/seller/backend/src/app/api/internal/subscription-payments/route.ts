import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminPaymentListQuerySchema } from '@/lib/contracts';
import { readSignedRequest } from '@/lib/internal-signature';
import { connectSellerDb } from '@/lib/mongo';
import { HttpError, handleRouteError } from '@/lib/http';
import { listPayments } from '@/lib/subscription-payment-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * GET /api/internal/subscription-payments?status&page&limit (Sprint 6 EP-14, S6-B4, D-093). Signed by the admin backend (MODERATION_API_SECRET);
 * a seller session means nothing here. Newest first, with the count of payments waiting for a decision.
 *
 *   200 { docs, page, limit, totalDocs, totalPages, pendingCount }   401 not signed   422 bad filters   503 the database is unavailable
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const signed = await readSignedRequest(request);
    if (!signed.ok) return signed.response;
    const parsed = adminPaymentListQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      return NextResponse.json({ errors: [{ message: 'Check the filters and try again.', code: 'INVALID_REQUEST' }] }, { status: 422, headers: NO_STORE });
    }
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    return NextResponse.json(await listPayments(parsed.data), { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
