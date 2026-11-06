
import { Types } from 'mongoose';
import { stripe } from '@markaz/billing';
import { Store, SubscriptionPlanModel } from '@markaz/db-schemas';
import { connectDb } from '@/lib/db';
import { isRecord, jsonResponse, requireInternalSignature } from '@/lib/internal-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CheckoutBody {
  priceId: string;
  storeId: string;
  ownerEmail: string;
  successUrl: string;
  cancelUrl: string;
}

function readCheckoutBody(value: unknown): CheckoutBody | null {
  if (!isRecord(value)) return null;
  const { priceId, storeId, ownerEmail, successUrl, cancelUrl } = value;
  if (
    typeof priceId !== 'string' || typeof storeId !== 'string' || typeof ownerEmail !== 'string' ||
    typeof successUrl !== 'string' || typeof cancelUrl !== 'string' || !Types.ObjectId.isValid(storeId)
  ) {
    return null;
  }
  return { priceId, storeId, ownerEmail, successUrl, cancelUrl };
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireInternalSignature(request);
  if (!auth.ok) return auth.response;

  let parsed: unknown;
  try {
    parsed = JSON.parse(auth.rawBody);
  } catch {
    return jsonResponse({ error: 'invalid JSON' }, 400);
  }
  const body = readCheckoutBody(parsed);
  if (!body) return jsonResponse({ error: 'invalid body' }, 422);

  await connectDb();
  const plan = await SubscriptionPlanModel.findOne({ stripePriceId: body.priceId }).lean();
  if (!plan) return jsonResponse({ error: 'unknown plan' }, 404);

  const store = await Store.findById(body.storeId).lean();
  if (!store) return jsonResponse({ error: 'store not found' }, 404);

  const billing = (store.billing ?? {}) as { stripeCustomerId?: string | null };
  let customerId = billing.stripeCustomerId ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create(
      { email: body.ownerEmail, metadata: { storeId: body.storeId } },
      { idempotencyKey: 'customer-' + body.storeId },
    );
    customerId = customer.id;
    await Store.updateOne({ _id: store._id }, { $set: { 'billing.stripeCustomerId': customerId } });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: body.storeId,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: body.successUrl,
    cancel_url: body.cancelUrl,
    subscription_data: { metadata: { storeId: body.storeId, planTier: plan.tier } },
    metadata: { storeId: body.storeId, planTier: plan.tier },
  });
  return jsonResponse({ sessionId: session.id, url: session.url }, 200);
}
