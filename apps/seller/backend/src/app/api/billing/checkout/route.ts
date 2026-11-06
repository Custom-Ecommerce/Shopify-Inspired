
import { loadBillingPorts } from '@/lib/services';
import { callAdminBridge } from '../_bridge';
import { isRecord, jsonResponse, requireBillingCaller, requireEnv } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const caller = await requireBillingCaller(request);
  if (!caller.ok) return caller.response;

  const baseUrl = requireEnv('SELLER_APP_URL');
  if (!baseUrl) return jsonResponse({ error: 'SELLER_APP_URL is not set' }, 500);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid JSON' }, 400);
  }
  const priceId = isRecord(body) && typeof body.priceId === 'string' ? body.priceId : '';
  if (!priceId) return jsonResponse({ error: 'priceId is required' }, 422);

  const store = await (await loadBillingPorts()).findSellerStoreForActor(caller.actorId);
  if (!store) return jsonResponse({ error: 'seller store not found' }, 404);

  return callAdminBridge('/api/internal/stripe/checkout-session', {
    priceId,
    storeId: store.storeId,
    ownerEmail: store.ownerEmail,
    successUrl: baseUrl + '/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}',
    cancelUrl: baseUrl + '/billing?checkout=cancelled',
  });
}
