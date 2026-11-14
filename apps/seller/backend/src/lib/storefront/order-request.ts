import { createHash } from 'node:crypto';
import {
  STOREFRONT_IDEMPOTENCY_KEY_PATTERN,
  STOREFRONT_ORDER_MAX_QTY,
  normalizePhoneE164,
  storefrontCreateOrderRequestSchema,
  storefrontOrderLookupRequestSchema,
} from '@/lib/contracts';
import { StorefrontHttpError } from '@/lib/storefront/errors';
import { normalizeOrderId } from '@/lib/storefront/order-id';

const HEX_ID = /^[0-9a-fA-F]{24}$/;
/** A real order is a few hundred bytes. Anything past this is not one. */
const MAX_BODY_BYTES = 32 * 1024;

export interface ParsedOrderRequest {
  idempotencyKey: string;
  /** Hash of the semantic content, so a reused key with a different body is detectable. */
  fingerprint: string;
  /** As the checkout contract outputs it: the phone in E.164 and the text cleaned, ready to store. */
  customer: { customerName: string; phone: string; whatsapp: string | null; address: string; city: string; email: string | null; note: string | null };
  paymentMethod: 'cod' | 'card';
  /** In capitals. Null when the shopper used none. */
  discountCode: string | null;
  /** Merged by variant: the same variant twice is one line with the summed quantity. Null asks for the only variant. */
  lines: Array<{ productId: string; variantId: string | null; qty: number }>;
}

const invalid = (message: string): StorefrontHttpError => new StorefrontHttpError(400, 'INVALID_REQUEST', message);

/** Reads a JSON body with a size cap. Malformed JSON is a 400, never a 500. */
export async function readJsonBody(request: Request): Promise<unknown> {
  const declared = Number.parseInt(request.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw invalid('Request body is too large.');

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) throw invalid('Request body is too large.');
  try {
    return JSON.parse(raw);
  } catch {
    throw invalid('Request body must be valid JSON.');
  }
}

/**
 * 400 INVALID_REQUEST for the first thing wrong with a body. The field is named twice: as `field`, and at the start of
 * the message ("customer.phone: ..."), which is how the storefront puts the message beside the right box. The message
 * comes from the contract and never repeats what was sent.
 */
export function invalidBody(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): StorefrontHttpError {
  const issue = error.issues[0];
  if (!issue) return invalid('Invalid request.');
  const field = issue.path.map(String).join('.');
  if (field === '') return invalid(issue.message);
  return new StorefrontHttpError(400, 'INVALID_REQUEST', field + ': ' + issue.message, { field });
}

const invalidQuantity = (productId: string, field: string): StorefrontHttpError =>
  new StorefrontHttpError(400, 'INVALID_QUANTITY', 'Quantity must be a whole number from 1 to ' + STOREFRONT_ORDER_MAX_QTY + '.', { productId, field });

/**
 * Validates a create-order body and header into a normalised request. Every refusal is a typed
 * StorefrontHttpError, in this order: shape and customer details, idempotency key, cart contents.
 *
 * Nothing the client says about money is read: the schema has no price or total field and strips any that
 * are sent.
 */
export function parseCreateOrderRequest(body: unknown, headerKey: string | null): ParsedOrderRequest {
  const parsed = storefrontCreateOrderRequestSchema.safeParse(body);
  if (!parsed.success) throw invalidBody(parsed.error);
  const input = parsed.data;

  // The header wins: the transport sends it, and it is the standard place for a retry key.
  const idempotencyKey = (headerKey?.trim() || input.idempotencyKey || '').trim();
  if (idempotencyKey === '') throw invalid('An Idempotency-Key header is required.');
  if (!STOREFRONT_IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw invalid('Idempotency-Key must be 8 to 128 characters: letters, digits, dash, underscore.');
  }

  if (input.lines.length === 0) throw new StorefrontHttpError(400, 'EMPTY_ORDER', 'The order has no items.', { field: 'lines' });

  const merged = new Map<string, ParsedOrderRequest['lines'][number]>();
  for (const [index, line] of input.lines.entries()) {
    const id = line.productId.toLowerCase();
    const variantId = line.variantId ? line.variantId.toLowerCase() : null;
    const field = 'lines.' + index + '.qty';
    if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > STOREFRONT_ORDER_MAX_QTY) throw invalidQuantity(line.productId, field);
    // An id that is not an ObjectId cannot be a product: reject it without a query.
    if (!HEX_ID.test(id)) {
      throw new StorefrontHttpError(422, 'UNKNOWN_PRODUCT', 'A product in the order is not available.', { productId: line.productId });
    }
    if (variantId !== null && !HEX_ID.test(variantId)) {
      throw new StorefrontHttpError(422, 'UNKNOWN_VARIANT', 'A variant in the order is not available.', { productId: line.productId });
    }
    const key = id + '|' + (variantId ?? '');
    const qty = (merged.get(key)?.qty ?? 0) + line.qty;
    if (qty > STOREFRONT_ORDER_MAX_QTY) throw invalidQuantity(line.productId, field);
    merged.set(key, { productId: id, variantId, qty });
  }
  const lines = [...merged.values()];

  const customer = input.customer;
  const paymentMethod = input.paymentMethod ?? 'cod';

  const discountCode = input.discountCode || null;

  return { idempotencyKey, fingerprint: fingerprintOf(customer, paymentMethod, lines, discountCode), customer, paymentMethod, discountCode, lines };
}

export function fingerprintOf(
  customer: ParsedOrderRequest['customer'],
  paymentMethod: string,
  lines: ParsedOrderRequest['lines'],
  discountCode: string | null = null,
): string {
  const canonical = JSON.stringify({
    n: customer.customerName,
    p: customer.phone,
    a: customer.address,
    c: customer.city,
    // Added only when present, so a retry of an order placed before these fields existed still matches.
    ...(customer.email === null ? {} : { e: customer.email }),
    ...(customer.note === null ? {} : { o: customer.note }),
    ...(customer.whatsapp === null ? {} : { w: customer.whatsapp }),
    ...(discountCode === null ? {} : { d: discountCode }),
    m: paymentMethod,
    l: lines.map((l) => [l.productId, l.variantId, l.qty] as const).sort((x, y) => (String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0)),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export interface ParsedLookupRequest {
  orderId: string;
  phone: string;
}

export function parseLookupRequest(body: unknown): ParsedLookupRequest {
  const parsed = storefrontOrderLookupRequestSchema.safeParse(body);
  if (!parsed.success) throw invalidBody(parsed.error);
  const phone = normalizePhoneE164(parsed.data.phone);
  if (phone === null) throw new StorefrontHttpError(400, 'INVALID_REQUEST', 'phone: enter a valid Pakistani mobile number.', { field: 'phone' });
  return { orderId: normalizeOrderId(parsed.data.orderId), phone };
}
