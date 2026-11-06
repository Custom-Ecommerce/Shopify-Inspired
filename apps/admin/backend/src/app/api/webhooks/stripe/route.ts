import { handleStripeWebhook, registerBillingPorts } from '@markaz/billing';
import { billingPortsImpl } from '@markaz/db-schemas';

// Boot: the webhook needs its persistence ports before the first Stripe event (ID-18).
registerBillingPorts(billingPortsImpl);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');
  const result = await handleStripeWebhook(rawBody, signature);
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json' },
  });
}
