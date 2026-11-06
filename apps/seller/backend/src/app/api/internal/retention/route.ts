import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { HttpError, handleRouteError, jsonError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { purgeExpiredProducts } from '@/lib/trash';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SECRET_HEADER = 'x-retention-secret';

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/**
 * POST /api/internal/retention. Called once a day by an external cron, with RETENTION_CRON_SECRET in the
 * x-retention-secret header. It purges what has been in trash for more than 365 days. Unset secret: 503, so a missing
 * setting closes the route rather than opening it. The clock is the server's: a request cannot choose the date.
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const secret = process.env.RETENTION_CRON_SECRET ?? '';
    if (secret === '') return jsonError(503, 'Retention is not configured');
    if (!timingSafeEqual(digest(request.headers.get(SECRET_HEADER) ?? ''), digest(secret))) return jsonError(401, 'Unauthorized');

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    return NextResponse.json(await purgeExpiredProducts(new Date()), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
