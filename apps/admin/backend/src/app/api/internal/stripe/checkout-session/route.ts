
import { Types } from 'mongoose';
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

/**
 * Sprint 6 EP-14 (D-118): Stripe subscriptions are OFF (SUBSCRIPTION_STRIPE_ENABLED, default off); subscription payment is manual first. While
 * off, this bridge answers 404 SUBSCRIPTION_STRIPE_OFF after the signature is checked and before anything else is read or created. The
 * Stripe client is loaded only past that point, so an off deployment never needs a Stripe key to answer.
 */
function stripeEnabled(): boolean {
  const raw = (process.env.SUBSCRIPTION_STRIPE_ENABLED ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireInternalSignature(request);
  if (!auth.ok) return auth.response;
  if (!stripeEnabled()) {
    return jsonResponse({ error: 'Subscription payments by card are not available yet.', code: 'SUBSCRIPTION_STRIPE_OFF' }, 404);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(auth.rawBody);
  } catch {
    return jsonResponse({ error: 'invalid JSON' }, 400);
  }
  const body = readCheckoutBody(parsed);
  if (!body) return jsonResponse({ error: 'invalid body' }, 422);

  const { stripe } = await import('@markaz/billing');
  await connectDb();
  const plan = await SubscriptionPlanModel.findOne({ stripePriceId: body.priceId }).lean();
  if (!plan) return jsonResponse({ error: 'unknown plan' }, 404);
  // Sprint 6: a plan no longer always has a Stripe price or an old tier.
  const stripePriceId = plan.stripePriceId;
  if (!stripePriceId) return jsonResponse({ error: 'plan has no Stripe price' }, 422);
  const planTier = plan.tier ?? plan.key ?? '';

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
    line_items: [{ price: stripePriceId, quantity: 1 }],
    success_url: body.successUrl,
    cancel_url: body.cancelUrl,
    subscription_data: { metadata: { storeId: body.storeId, planTier } },
    metadata: { storeId: body.storeId, planTier },
  });
  return jsonResponse({ sessionId: session.id, url: session.url }, 200);
}
