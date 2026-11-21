import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { NO_STORE } from '@/lib/account-support';
import { requireDatabase } from '@/lib/accounts';
import { authenticate } from '@/lib/auth';
import { handleRouteError } from '@/lib/http';
import { requireSellerActor } from '@/lib/owned-store';
import { assertCan } from '@/lib/services';
import { readPaymentInstructions } from '@/lib/subscription-payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/subscription/instructions (Sprint 6 EP-14, S6-B4): how to pay, as the admin typed it in the platform settings.
 *
 *   200 { paymentInstructions, supportEmail, supportPhone }   each null when not set
 *   401 no session   403 an admin session
 *
 * The texts are PLAIN TEXT, never HTML, and are returned as typed (JSON is not an HTML context). The seller portal shows them as text (React
 * escapes them) and the emails escape them in the template; nothing renders them as markup.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    requireSellerActor(ctx);
    assertCan(ctx.actor, 'read', 'subscriptionPayments', ['planKey']);
    await requireDatabase();
    return NextResponse.json(await readPaymentInstructions(), { headers: NO_STORE });
  } catch (err) {
    return handleRouteError(err);
  }
}
