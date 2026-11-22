import type { NextRequest } from 'next/server';
import { storefrontFailure } from '@/lib/storefront/preview-request';
import { submitStoreContact } from '@/lib/storefront/contact-submit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/storefront/v1/stores/:id/contact (Sprint 7, S7-B4). Public: a shopper's message to the store, body { name, email?, phone?, message, consent: true,
 * website? } (strict; `website` is the honeypot). 5 per client address per store per 10 minutes. The answer is success ONLY after the message is stored.
 *   201 { data: { received: true } }   400 INVALID_REQUEST { field }   404 STORE_NOT_FOUND   403 STORE_NOT_ACTIVE   429 RATE_LIMITED   503 not stored
 * A filled honeypot answers 201 and stores nothing.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    return await submitStoreContact(request, id);
  } catch (err) {
    return storefrontFailure(err, false);
  }
}
