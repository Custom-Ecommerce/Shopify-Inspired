import { objectIdSchema, stripeOnboardRequestSchema } from '@/lib/contracts';
import { callAdminBridge } from '@/app/api/billing/_bridge';
import { jsonResponse, requireBillingCaller, requireEnv } from '@/app/api/billing/_shared';
import { invalidStoreId, parseBody } from '@/lib/placeholder';
import { loadBillingPorts } from '@/lib/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/stores/:id/billing/onboard. Starts Stripe account onboarding for the caller's own store,
 * through the same billing ports and admin bridge as /api/billing/onboard.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  if (!objectIdSchema.safeParse(id).success) return invalidStoreId();

  const caller = await requireBillingCaller(request);
  if (!caller.ok) return caller.response;

  const body = await parseBody(request, stripeOnboardRequestSchema);
  if (!body.ok) return body.response;
  if (body.data.storeId !== id) {
    return jsonResponse({ error: 'storeId must match the path' }, 403);
  }

  const baseUrl = requireEnv('SELLER_APP_URL');
  if (!baseUrl) return jsonResponse({ error: 'SELLER_APP_URL is not set' }, 500);

  const ports = await loadBillingPorts();
  const store = await ports.findSellerStoreForActor(caller.actorId);
  if (!store || String(store.storeId) !== id) {
    return jsonResponse({ error: 'seller store not found' }, 404);
  }

  return callAdminBridge('/api/internal/stripe/connect-account', {
    storeId: store.storeId,
    ownerEmail: store.ownerEmail,
    countryCode: store.countryCode,
    refreshUrl: baseUrl + '/billing/onboard?refresh=1',
    returnUrl: baseUrl + '/billing/onboard/complete',
  });
}
