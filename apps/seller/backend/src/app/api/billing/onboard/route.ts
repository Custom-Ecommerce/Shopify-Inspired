
import { loadBillingPorts } from '@/lib/services';
import { callAdminBridge } from '../_bridge';
import { jsonResponse, requireBillingCaller, requireEnv } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const caller = await requireBillingCaller(request);
  if (!caller.ok) return caller.response;

  const baseUrl = requireEnv('SELLER_APP_URL');
  if (!baseUrl) return jsonResponse({ error: 'SELLER_APP_URL is not set' }, 500);

  const store = await (await loadBillingPorts()).findSellerStoreForActor(caller.actorId);
  if (!store) return jsonResponse({ error: 'seller store not found' }, 404);

  return callAdminBridge('/api/internal/stripe/connect-account', {
    storeId: store.storeId,
    ownerEmail: store.ownerEmail,
    countryCode: store.countryCode,
    refreshUrl: baseUrl + '/billing/onboard?refresh=1',
    returnUrl: baseUrl + '/billing/onboard/complete',
  });
}
