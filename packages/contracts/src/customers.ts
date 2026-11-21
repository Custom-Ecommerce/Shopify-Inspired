import { z } from 'zod';
import { normalizePhoneE164 } from './checkout';
import { CUSTOMER_SEARCH_MAX, CUSTOMER_SORTS } from './broadcast';

/*
 * Sprint 5 EP-10.US01 / US02 (D-107, D-108): the seller's view of their end customers. There is no customer collection: a
 * customer is derived from the store's orders and grouped by the normalized phone (Order.phoneKey), by the lower-case email
 * only for an order with no phone. The only stored extra is the seller's own note and tags (CustomerNote).
 *
 * The phone rule is normalizePhoneE164 from ./checkout. There is no second normaliser.
 */

export const CUSTOMER_NOTE_MAX = 500;
export const CUSTOMER_TAG_MAX = 20;
export const CUSTOMER_TAGS_MAX_COUNT = 5;
/** The most rows one CSV export holds. */
export const CUSTOMER_EXPORT_MAX_ROWS = 5000;
/** The most orders a customer's detail lists (newest first). The statistics always count every order. */
export const CUSTOMER_DETAIL_ORDERS_MAX = 100;
/** The most distinct delivery addresses a customer's detail lists. */
export const CUSTOMER_DETAIL_ADDRESSES_MAX = 10;

const KEY_EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;

/**
 * The one form a customer key can take: the normalized phone (+923xxxxxxxxx) or the lower-case email. Any spelling of the same
 * phone gives the same key, so a link made from either is the same customer. Null when the input is neither.
 */
export function normalizeCustomerKey(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (value === '' || value.length > 254) return null;
  if (value.includes('@')) {
    const email = value.toLowerCase();
    return KEY_EMAIL.test(email) ? email : null;
  }
  return normalizePhoneE164(value);
}

const NO_HTML = /[<>]/;

/** Plain text: control characters become spaces (a newline stays in the note), then trimmed. No angle brackets. */
const noteSchema = z
  .string({ error: 'note must be text' })
  .transform((value) => value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').trim())
  .pipe(
    z
      .string()
      .max(CUSTOMER_NOTE_MAX, 'note can be at most ' + CUSTOMER_NOTE_MAX + ' characters')
      .refine((value) => !NO_HTML.test(value), 'note cannot contain < or >'),
  );

const tagSchema = z
  .string({ error: 'a tag must be text' })
  .transform((value) => value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(1, 'a tag cannot be empty')
      .max(CUSTOMER_TAG_MAX, 'a tag can be at most ' + CUSTOMER_TAG_MAX + ' characters')
      .refine((value) => !NO_HTML.test(value), 'a tag cannot contain < or >'),
  );

/** Up to five tags; a tag repeated in another letter case is kept once (the first spelling). */
const tagsSchema = z
  .array(tagSchema, { error: 'tags must be a list' })
  .max(CUSTOMER_TAGS_MAX_COUNT, 'at most ' + CUSTOMER_TAGS_MAX_COUNT + ' tags')
  .transform((tags) => {
    const seen = new Set<string>();
    return tags.filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

/** PATCH /api/stores/:id/customers/:key/note. An empty note clears it. At least one of the two is required. */
export const customerNoteRequestSchema = z
  .object({ note: noteSchema.optional(), tags: tagsSchema.optional() })
  .strict()
  .refine((value) => value.note !== undefined || value.tags !== undefined, { message: 'send a note, tags, or both', path: ['note'] });
export type CustomerNoteRequest = z.output<typeof customerNoteRequestSchema>;

/** The filters shared by the list and the CSV export. */
export const customerFilterShape = {
  phone: z.enum(['1']).optional(),
  q: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().max(CUSTOMER_SEARCH_MAX, 'q can be at most ' + CUSTOMER_SEARCH_MAX + ' characters'))
    .optional(),
  sort: z.enum(CUSTOMER_SORTS).optional(),
  repeat: z.enum(['1']).optional(),
  hasEmail: z.enum(['1']).optional(),
  unsubscribed: z.enum(['1']).optional(),
};

/** GET /api/stores/:id/customers/export?q=&sort=&repeat=1&hasEmail=1&unsubscribed=1&phone=1 (the same filters as the list, no paging). */
export const customerExportQuerySchema = z.object(customerFilterShape).strict();
export type CustomerExportQuery = z.output<typeof customerExportQuerySchema>;

/** The CSV columns, in order (EP-10.US02.T04). */
export const CUSTOMER_CSV_COLUMNS = ['Name', 'Phone', 'Email', 'Orders', 'Delivered', 'Total spent', 'Last order', 'Unsubscribed'] as const;

export interface CustomerStats {
  orderCount: number;
  deliveredCount: number;
  cancelledCount: number;
  /** Whole rupees: delivered orders, item subtotal after the discount, delivery not counted. */
  totalSpent: number;
  /** Whole rupees: totalSpent over deliveredCount, rounded; 0 while nothing is delivered. */
  averageOrderValue: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  /** Zero until returns exist (EP-13). */
  returnsCount: number;
}

export interface CustomerOrderRow {
  /** The order's own id (the dashboard order page is /orders/<id>). */
  id: string;
  /** The order number the shopper sees. */
  orderId: string;
  createdAt: string;
  status: string;
  total: number;
  paymentMethod: string | null;
  paymentStatus: string;
}

export interface CustomerAddress {
  address: string;
  city: string | null;
}

export interface CustomerDetail {
  /** The customer key (see CustomerRow.id). */
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  unsubscribed: boolean;
  stats: CustomerStats;
  note: string;
  tags: string[];
  noteUpdatedAt: string | null;
  /** Newest first, at most CUSTOMER_DETAIL_ORDERS_MAX. */
  orders: CustomerOrderRow[];
  /** Distinct delivery addresses of the listed orders, newest first, at most CUSTOMER_DETAIL_ADDRESSES_MAX. */
  addresses: CustomerAddress[];
}

export interface CustomerNoteResult {
  note: string;
  tags: string[];
  updatedAt: string;
}
