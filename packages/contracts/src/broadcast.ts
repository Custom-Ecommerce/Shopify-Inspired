import { z } from 'zod';

/*
 * Sprint 4 EP-07.US04 (D-092): customers of a store and email broadcasts to them. The customers are derived from the
 * store's orders (there is no separate customer collection); the broadcast recipients are the customers with an email who
 * have not unsubscribed. Everything a seller writes is plain text.
 */

export const BROADCAST_SUBJECT_MAX = 120;
export const BROADCAST_MESSAGE_MAX = 2000;
/** The most recipients one broadcast may have. More is refused (422), never cut. */
export const BROADCAST_RECIPIENT_CAP = 500;
export const CUSTOMER_LIST_DEFAULT_LIMIT = 20;
export const CUSTOMER_LIST_MAX_LIMIT = 50;
export const BROADCAST_LIST_MAX_LIMIT = 50;

export const BROADCAST_CODES = {
  /** 429: this store already made a broadcast today (Asia/Karachi day). */
  DAILY_LIMIT: 'BROADCAST_DAILY_LIMIT',
  /** 422: more than BROADCAST_RECIPIENT_CAP recipients. */
  TOO_LARGE: 'BROADCAST_TOO_LARGE',
  /** 409: the recipient count is not the one the seller confirmed. Preview again. */
  COUNT_CHANGED: 'BROADCAST_COUNT_CHANGED',
  /** 422: nobody would receive it. */
  NO_RECIPIENTS: 'BROADCAST_NO_RECIPIENTS',
  /** 503: UNSUBSCRIBE_SIGNING_SECRET (or the portal address) is not set, so no broadcast can carry a safe unsubscribe link. */
  NOT_CONFIGURED: 'BROADCAST_NOT_CONFIGURED',
} as const;

const NO_HTML = /[<>]/;

const subjectSchema = z
  .string({ error: 'subject must be text' })
  .transform((value) => value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(1, 'subject is required')
      .max(BROADCAST_SUBJECT_MAX, 'subject can be at most ' + BROADCAST_SUBJECT_MAX + ' characters')
      .refine((value) => !NO_HTML.test(value), 'subject cannot contain < or >'),
  );

const messageSchema = z
  .string({ error: 'message must be text' })
  .transform((value) => value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(1, 'message is required')
      .max(BROADCAST_MESSAGE_MAX, 'message can be at most ' + BROADCAST_MESSAGE_MAX + ' characters')
      .refine((value) => !NO_HTML.test(value), 'message cannot contain < or >'),
  );

/** POST /api/stores/:id/broadcast/preview */
export const broadcastPreviewRequestSchema = z.object({ subject: subjectSchema, message: messageSchema }).strict();
export type BroadcastPreviewRequest = z.output<typeof broadcastPreviewRequestSchema>;

/** POST /api/stores/:id/broadcast: the seller confirms the count the preview showed. */
export const createBroadcastRequestSchema = z
  .object({
    subject: subjectSchema,
    message: messageSchema,
    expectedCount: z.number({ error: 'expectedCount must be a number' }).int('expectedCount must be a whole number').min(0).max(BROADCAST_RECIPIENT_CAP + 1),
  })
  .strict();
export type CreateBroadcastRequest = z.output<typeof createBroadcastRequestSchema>;

/** Sprint 5 EP-10.US02: how the customer list can be ordered. last_order is newest buyer first. */
export const CUSTOMER_SORTS = ['last_order', 'total_spent', 'orders'] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];
export const CUSTOMER_SEARCH_MAX = 80;

/**
 * GET /api/stores/:id/customers?page=&limit=&phone=1&q=&sort=&repeat=1&hasEmail=1&unsubscribed=1
 * (Sprint 4 added page, limit and phone; Sprint 5 EP-10.US02 adds the rest. Every new field is optional, so the broadcast page's
 * call, which sends only page, limit and phone, is unchanged.)
 */
export const customerListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(CUSTOMER_LIST_MAX_LIMIT).default(CUSTOMER_LIST_DEFAULT_LIMIT),
    /** 1: only customers with a phone number (the WhatsApp list). */
    phone: z.enum(['1']).optional(),
    /** Name, phone or email, case-insensitive, matched as plain text (never as a pattern). */
    q: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().max(CUSTOMER_SEARCH_MAX, 'q can be at most ' + CUSTOMER_SEARCH_MAX + ' characters'))
      .optional(),
    sort: z.enum(CUSTOMER_SORTS).optional(),
    /** 1: customers with two or more orders. */
    repeat: z.enum(['1']).optional(),
    /** 1: customers with an email address. */
    hasEmail: z.enum(['1']).optional(),
    /** 1: customers who unsubscribed from broadcasts. */
    unsubscribed: z.enum(['1']).optional(),
  })
  .strict();
export type CustomerListQuery = z.output<typeof customerListQuerySchema>;

/** GET /api/stores/:id/broadcast?page=&limit= */
export const broadcastListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(BROADCAST_LIST_MAX_LIMIT).default(20),
  })
  .strict();
export type BroadcastListQuery = z.output<typeof broadcastListQuerySchema>;

/** The public unsubscribe call: store id, the customer's email and the signature of the link. */
export const unsubscribeRequestSchema = z
  .object({
    store: z.string().regex(/^[0-9a-fA-F]{24}$/),
    email: z.string().max(254),
    sig: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type UnsubscribeRequest = z.output<typeof unsubscribeRequestSchema>;

export interface CustomerRow {
  /**
   * The key the customer was grouped by (Sprint 5, D-107): the normalized phone (+923xxxxxxxxx), or the lower-case email for
   * an order with no phone. It is also the :key of the detail, note and export routes.
   */
  id: string;
  name: string | null;
  email: string | null;
  /** The normalized phone for a phone-keyed customer. */
  phone: string | null;
  /** The customer's WhatsApp number when it differs from the phone. */
  whatsapp: string | null;
  orderCount: number;
  lastOrderAt: string | null;
  unsubscribed: boolean;
  /** Sprint 5 EP-10.US01: delivered orders, whole rupees spent on them and the seller's tags. */
  deliveredCount: number;
  totalSpent: number;
  tags: string[];
}

export interface CustomerList {
  docs: CustomerRow[];
  page: number;
  limit: number;
  totalDocs: number;
  totalPages: number;
}

export interface BroadcastPreview {
  /** Customers with an email who have not unsubscribed. Never more than the cap. */
  recipientCount: number;
  cap: number;
  /** True when more than the cap would receive it: the broadcast cannot be sent. */
  tooLarge: boolean;
}

export interface BroadcastCounts {
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
}

export interface BroadcastRow {
  id: string;
  subject: string;
  message: string;
  recipientCount: number;
  createdAt: string;
  counts: BroadcastCounts;
}

export interface BroadcastList {
  docs: BroadcastRow[];
  page: number;
  limit: number;
  totalDocs: number;
  totalPages: number;
}
