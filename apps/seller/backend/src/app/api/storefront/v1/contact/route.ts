import type { NextRequest } from 'next/server';
import { storefrontFailure } from '@/lib/storefront/preview-request';
import { submitPlatformContact } from '@/lib/storefront/contact-submit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/storefront/v1/contact (Sprint 7, S7-B4). Public: a visitor's message to the platform, body { name, email, message, consent: true, website? }. Stored
 * as a platform ContactMessage and queued to the support address. Success ONLY after it is stored.
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    return await submitPlatformContact(request);
  } catch (err) {
    return storefrontFailure(err, false);
  }
}
