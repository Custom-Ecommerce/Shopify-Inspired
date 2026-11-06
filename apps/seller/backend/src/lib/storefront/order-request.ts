import { createHash } from 'node:crypto';
import { normalizePhoneE164 } from '@markaz/platform-kit/phone';
import {
  STOREFRONT_IDEMPOTENCY_KEY_PATTERN,
  STOREFRONT_ORDER_MAX_QTY,
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
  customer: { customerName: string; phone: string; address: string; city: string | null };
  paymentMethod: 'cod' | 'card';
  /** Merged by product: the same product twice is one line with the summed quantity. */
  lines: Array<{ productId: string; qty: number }>;
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

function firstIssue(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid request.';
  const path = issue.path.map(String).join('.');
  return path ? path + ': ' + issue.message : issue.message;
}

/**
 * Validates a create-order body and header into a normalised request. Every refusal is a typed
 * StorefrontHttpError, in this order: shape, idempotency key, phone, cart contents.
 *
 * Nothing the client says about money is read: the schema has no price or total field and strips any that
 * are sent.
 */
export function parseCreateOrderRequest(body: unknown, headerKey: string | null): ParsedOrderRequest {
  const parsed = storefrontCreateOrderRequestSchema.safeParse(body);
  if (!parsed.success) throw invalid(firstIssue(parsed.error));
  const input = parsed.data;

  // The header wins: the transport sends it, and it is the standard place for a retry key.
  const idempotencyKey = (headerKey?.trim() || input.idempotencyKey || '').trim();
  if (idempotencyKey === '') throw invalid('An Idempotency-Key header is required.');
  if (!STOREFRONT_IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw invalid('Idempotency-Key must be 8 to 128 characters: letters, digits, dash, underscore.');
  }

  const phone = normalizePhoneE164(input.customer.phone);
  if (phone === null) throw invalid('customer.phone: enter a valid Pakistani mobile number.');

  if (input.lines.length === 0) throw new StorefrontHttpError(400, 'EMPTY_ORDER', 'The order has no items.');

  const merged = new Map<string, number>();
  for (const line of input.lines) {
    const id = line.productId.toLowerCase();
    if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > STOREFRONT_ORDER_MAX_QTY) {
      throw new StorefrontHttpError(400, 'INVALID_QUANTITY', 'Quantity must be a whole number from 1 to ' + STOREFRONT_ORDER_MAX_QTY + '.', {
        productId: line.productId,
      });
    }
    // An id that is not an ObjectId cannot be a product: reject it without a query.
    if (!HEX_ID.test(id)) {
      throw new StorefrontHttpError(422, 'UNKNOWN_PRODUCT', 'A product in the order is not available.', { productId: line.productId });
    }
    const qty = (merged.get(id) ?? 0) + line.qty;
    if (qty > STOREFRONT_ORDER_MAX_QTY) {
      throw new StorefrontHttpError(400, 'INVALID_QUANTITY', 'Quantity must be a whole number from 1 to ' + STOREFRONT_ORDER_MAX_QTY + '.', {
        productId: line.productId,
      });
    }
    merged.set(id, qty);
  }
  const lines = [...merged.entries()].map(([productId, qty]) => ({ productId, qty }));

  const customer = {
    customerName: input.customer.customerName,
    phone,
    address: input.customer.address,
    city: input.customer.city ?? null,
  };
  const paymentMethod = input.paymentMethod ?? 'cod';

  return { idempotencyKey, fingerprint: fingerprintOf(customer, paymentMethod, lines), customer, paymentMethod, lines };
}

export function fingerprintOf(
  customer: ParsedOrderRequest['customer'],
  paymentMethod: string,
  lines: ParsedOrderRequest['lines'],
): string {
  const canonical = JSON.stringify({
    n: customer.customerName,
    p: customer.phone,
    a: customer.address,
    c: customer.city,
    m: paymentMethod,
    l: [...lines].sort((x, y) => (x.productId < y.productId ? -1 : x.productId > y.productId ? 1 : 0)).map((l) => [l.productId, l.qty]),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export interface ParsedLookupRequest {
  orderId: string;
  phone: string;
}

export function parseLookupRequest(body: unknown): ParsedLookupRequest {
  const parsed = storefrontOrderLookupRequestSchema.safeParse(body);
  if (!parsed.success) throw invalid(firstIssue(parsed.error));
  const phone = normalizePhoneE164(parsed.data.phone);
  if (phone === null) throw invalid('phone: enter a valid Pakistani mobile number.');
  return { orderId: normalizeOrderId(parsed.data.orderId), phone };
}
