import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { ZodType } from 'zod';
import { platformContactRequestSchema, storeContactRequestSchema } from '@/lib/contracts';
import { notifyPlatformContact, notifyStoreContact } from '@/lib/contact';
import { connectSellerDb } from '@/lib/mongo';
import { ContactMessage } from '@/lib/services';
import { StorefrontHttpError, databaseUnavailable } from '@/lib/storefront/errors';
import { CONTACT_LIMIT, enforceRateLimit } from '@/lib/storefront/rate-limit';
import { assertStoreId, loadActiveStore } from '@/lib/storefront/store-guard';

/**
 * Sprint 7 (S7-B4): the two public contact forms, as one flow. Order: the limiter (cheap, before anything else), the store (for a store form), the body, the
 * honeypot, then the STORE of the message, and only then the success answer. A message that could not be stored is a 503, never a success (this fixes the
 * old platform form that answered "received" without keeping anything). The bell alert and the emails run after the response and cannot change it.
 */

/** The id the platform form uses where a store id would be: it scopes the limiter and the signed client address. */
export const PLATFORM_SCOPE = 'platform';

const MAX_BODY_BYTES = 16 * 1024;
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const invalid = (message: string, field?: string): StorefrontHttpError => new StorefrontHttpError(400, 'INVALID_REQUEST', message, field === undefined ? {} : { field });

async function readBody<T>(request: NextRequest, schema: ZodType<T, unknown>): Promise<T> {
  const text = await request.text().catch(() => '');
  if (text.length > MAX_BODY_BYTES) throw invalid('The message is too long.', 'message');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw invalid('Body must be JSON.');
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const field = issue?.code === 'unrecognized_keys' ? String(issue.keys[0] ?? '') : String(issue?.path[0] ?? '');
  throw invalid(issue?.message ?? 'The form is not valid.', field === '' ? undefined : field);
}

const received = (status: number): NextResponse => NextResponse.json({ data: { received: true } }, { status, headers: NO_STORE });

async function store<T>(create: () => Promise<T>): Promise<T> {
  try {
    await connectSellerDb();
    return await create();
  } catch (err) {
    console.error('[seller-backend] a contact message could not be stored', err instanceof Error ? err.message : 'unknown');
    throw databaseUnavailable();
  }
}

/** POST .../stores/:id/contact. */
export async function submitStoreContact(request: NextRequest, storeId: string): Promise<NextResponse> {
  assertStoreId(storeId);
  await enforceRateLimit(CONTACT_LIMIT, storeId, request.headers);
  await loadActiveStore(storeId);
  const body = await readBody(request, storeContactRequestSchema);
  // The honeypot: a filled hidden field is a bot. It is told "received" and nothing is stored, so it learns nothing from the answer.
  if (typeof body.website === 'string' && body.website.trim() !== '') return received(201);

  const created = await store(async () =>
    (await ContactMessage.create({
      scope: 'store',
      store: storeId,
      name: body.name,
      email: body.email ?? '',
      phone: body.phone ? body.phone : null,
      message: body.message,
      consent: true,
      status: 'new',
      replies: [],
      revision: 0,
    })) as unknown as { _id: unknown },
  );
  notifyStoreContact(storeId, { id: String(created._id), name: body.name, email: body.email ?? '', phone: body.phone ? body.phone : null, message: body.message });
  return received(201);
}

/** POST /api/storefront/v1/contact: the platform's own contact form. */
export async function submitPlatformContact(request: NextRequest): Promise<NextResponse> {
  await enforceRateLimit(CONTACT_LIMIT, PLATFORM_SCOPE, request.headers);
  const body = await readBody(request, platformContactRequestSchema);
  if (typeof body.website === 'string' && body.website.trim() !== '') return received(201);

  const created = await store(async () =>
    (await ContactMessage.create({
      scope: 'platform',
      store: null,
      name: body.name,
      email: body.email,
      phone: null,
      message: body.message,
      consent: true,
      status: 'new',
      replies: [],
      revision: 0,
    })) as unknown as { _id: unknown },
  );
  notifyPlatformContact({ id: String(created._id), name: body.name, email: body.email, phone: null, message: body.message });
  return received(201);
}
