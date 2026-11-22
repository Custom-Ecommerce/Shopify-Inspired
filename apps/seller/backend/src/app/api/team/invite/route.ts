import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { handleRouteError } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { inviteInfo } from '@/lib/team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/team/invite?token=<raw> (S8-B2, D-118). What the accept page may show to a person holding a VALID invite token: the store's name, the role and the invited
 * email (so they can sign in or create the account with it). No session is needed (the invitee may not have an account yet). Anything else (unknown, expired, used,
 * a malformed token) is the same { valid: false }: a guess learns nothing. Never cached.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const token = request.nextUrl.searchParams.get('token');
    if (token === null || token.length > 200) return NextResponse.json({ valid: false }, { headers: { 'Cache-Control': 'no-store' } });
    await connectSellerDb();
    return NextResponse.json(await inviteInfo(token), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
