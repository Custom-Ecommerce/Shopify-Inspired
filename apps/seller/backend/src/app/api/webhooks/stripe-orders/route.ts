import { handleOrderPaymentWebhook } from '@/lib/storefront/card-webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/webhooks/stripe-orders. The signature covers the exact bytes Stripe sent, so the body is read as text. */
export async function POST(request: Request): Promise<Response> {
  const result = await handleOrderPaymentWebhook(await request.text(), request.headers.get('stripe-signature'));
  return Response.json(result.body, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
}
