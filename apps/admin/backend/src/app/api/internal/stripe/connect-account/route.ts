
import { Types } from 'mongoose';
import { stripe } from '@markaz/billing';
import { Store } from '@markaz/db-schemas';
import { connectDb } from '@/lib/db';
import { isRecord, jsonResponse, requireInternalSignature } from '@/lib/internal-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ConnectBody {
  storeId: string;
  ownerEmail: string;
  countryCode: string;
  refreshUrl: string;
  returnUrl: string;
}

function readConnectBody(value: unknown): ConnectBody | null {
  if (!isRecord(value)) return null;
  const { storeId, ownerEmail, countryCode, refreshUrl, returnUrl } = value;
  if (
    typeof storeId !== 'string' || typeof ownerEmail !== 'string' || typeof countryCode !== 'string' ||
    typeof refreshUrl !== 'string' || typeof returnUrl !== 'string' || !Types.ObjectId.isValid(storeId)
  ) {
    return null;
  }
  return { storeId, ownerEmail, countryCode, refreshUrl, returnUrl };
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
  const body = readConnectBody(parsed);
  if (!body) return jsonResponse({ error: 'invalid body' }, 422);

  await connectDb();
  const store = await Store.findById(body.storeId).lean();
  if (!store) return jsonResponse({ error: 'store not found' }, 404);

  const billing = (store.billing ?? {}) as { stripeAccountId?: string | null };
  let accountId = billing.stripeAccountId ?? null;
  if (!accountId) {
    const account = await stripe.accounts.create(
      {
        type: 'express',
        country: body.countryCode,
        email: body.ownerEmail,
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        metadata: { storeId: body.storeId },
      },
      { idempotencyKey: 'connect-account-' + body.storeId },
    );
    accountId = account.id;
    await Store.updateOne({ _id: store._id }, { $set: { 'billing.stripeAccountId': accountId } });
  }

  const link = await stripe.accountLinks.create({
    account: accountId,
    type: 'account_onboarding',
    refresh_url: body.refreshUrl,
    return_url: body.returnUrl,
  });
  return jsonResponse({ accountId, url: link.url, expiresAt: link.expires_at }, 200);
}
