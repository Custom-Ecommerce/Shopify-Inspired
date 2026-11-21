import { z } from 'zod';
import { objectIdSchema } from './object-id';

/*
 * Sprint 5 EP-13 (D-107, D-108, D-109): returns and refunds. The EXISTING Return model and this contract are extended, not replaced.
 * A return is requested by the shopper (order number + phone, no login), approved or rejected by the seller, received (with stock put
 * back), and refunded in parts. A refund is only RECORDED: the seller pays the money back by their own means, nothing moves through the
 * system. Money is whole rupees. A line is productId + variantId (there is no lineId).
 */

/** Return reasons as the admin collection defined them (kept: the model's `reason` is the same code as `reasonCode`). */
export const RETURN_REASONS = ['damaged', 'wrong_item', 'changed_mind', 'other'] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];
export const RETURN_REASON_LABELS: Readonly<Record<ReturnReason, string>> = {
  damaged: 'Damaged or defective',
  wrong_item: 'Wrong item received',
  changed_mind: 'Changed my mind',
  other: 'Other reason',
};

/** completed is a legacy value (Sprint 4 shell): still readable, never written by the new routes. */
export const RETURN_STATUSES = ['requested', 'approved', 'rejected', 'received', 'refunded', 'completed'] as const;
export const REFUND_TYPES = ['store_credit', 'cod_refund', 'replacement'] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

/**
 * Allowed moves between statuses (ID-24, SB-3). Each is made by its own action route (approve, reject, receive, refund), one
 * compare-and-set each; the generic PATCH refuses the moves that have side effects (received, refunded).
 */
export const RETURN_TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  requested: ['approved', 'rejected'],
  approved: ['received'],
  rejected: [],
  received: ['refunded'],
  refunded: [],
  completed: [],
};

export const REFUND_METHODS = ['bank', 'jazzcash', 'easypaisa', 'cash'] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

export const RETURN_WINDOW_DEFAULT = 7;
export const RETURN_WINDOW_MAX = 30;
export const RETURN_NOTE_MAX = 300;
export const RETURN_REJECT_REASON_MIN = 5;
export const RETURN_REJECT_REASON_MAX = 200;
export const RETURN_REFERENCE_MAX = 100;
export const RETURN_ITEMS_MAX = 50;
export const RETURN_LINE_QTY_MAX = 99;

/** Why a return cannot be requested (the eligibility answer). */
export const RETURN_INELIGIBLE_REASONS = ['not_delivered', 'window_closed', 'returns_off', 'card_order', 'nothing_left'] as const;
export type ReturnIneligibleReason = (typeof RETURN_INELIGIBLE_REASONS)[number];

/** 422 on the seller refund route for a card order: card is off in Sprint 5 and card refunds belong to the gateways epic. */
export const CARD_REFUND_UNSUPPORTED = 'CARD_REFUND_UNSUPPORTED';
export const CARD_REFUND_UNSUPPORTED_MESSAGE = 'Refunds of card orders are not supported yet.';

const isoDate = z.string().datetime({ offset: true });

// --------------------------------------------------------------------------------------------------------- text and lines

const NO_HTML = /[<>]/;

/** One line of plain text: controls become spaces, runs of space one space, trimmed; < and > refused. */
function plainLine(max: number, label: string, min = 0) {
  return z
    .string({ error: label + ' must be text' })
    .transform((value) => value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim())
    .pipe(
      z
        .string()
        .min(min, label + ' must be at least ' + min + ' characters')
        .max(max, label + ' can be at most ' + max + ' characters')
        .refine((value) => !NO_HTML.test(value), label + ' cannot contain < or >'),
    );
}

const lineKey = {
  productId: z.string({ error: 'productId is required' }).trim().min(1, 'productId is required').max(40),
  variantId: z.string({ error: 'variantId is required' }).trim().min(1, 'variantId is required').max(40),
};
const quantity = z.number({ error: 'quantity must be a number' }).int('quantity must be a whole number').min(1, 'quantity must be at least 1').max(RETURN_LINE_QTY_MAX, 'quantity is too large');

/** POST .../orders/:number/returns (public). Strict. The phone is checked by the route with normalizePhoneE164 like the track route. */
export const returnCreateRequestSchema = z
  .object({
    phone: z.string({ error: 'phone is required' }).max(32, 'phone is too long'),
    items: z
      .array(z.object({ ...lineKey, quantity }).strict(), { error: 'items must be a list' })
      .min(1, 'choose at least one item')
      .max(RETURN_ITEMS_MAX, 'too many items'),
    reasonCode: z.enum(RETURN_REASONS, { error: 'choose a reason' }),
    note: plainLine(RETURN_NOTE_MAX, 'note').optional(),
  })
  .strict()
  .transform((value) => ({ ...value, note: value.note === undefined || value.note === '' ? null : value.note }));
export type ReturnCreateRequest = z.output<typeof returnCreateRequestSchema>;

/** POST .../returns/:id/reject. */
export const returnRejectRequestSchema = z
  .object({ reason: plainLine(RETURN_REJECT_REASON_MAX, 'reason', RETURN_REJECT_REASON_MIN) })
  .strict();
export type ReturnRejectRequest = z.output<typeof returnRejectRequestSchema>;

/** POST .../returns/:id/receive: what came back, and which of it goes back on the shelf. */
export const returnReceiveRequestSchema = z
  .object({
    items: z
      .array(z.object({ ...lineKey, quantity, restock: z.boolean({ error: 'restock must be true or false' }) }).strict(), { error: 'items must be a list' })
      .min(1, 'list at least one item')
      .max(RETURN_ITEMS_MAX, 'too many items'),
  })
  .strict();
export type ReturnReceiveRequest = z.output<typeof returnReceiveRequestSchema>;

/** POST .../returns/:id/refund: one recorded payment back to the customer, in whole rupees. */
export const returnRefundRequestSchema = z
  .object({
    amount: z.number({ error: 'amount must be a number' }).int('amount must be whole rupees').min(1, 'amount must be at least 1').max(10_000_000, 'amount is too large'),
    method: z.enum(REFUND_METHODS, { error: 'choose bank, jazzcash, easypaisa or cash' }),
    reference: plainLine(RETURN_REFERENCE_MAX, 'reference').optional(),
  })
  .strict()
  .transform((value) => ({ ...value, reference: value.reference === undefined || value.reference === '' ? null : value.reference }));
export type ReturnRefundRequest = z.output<typeof returnRefundRequestSchema>;

/** GET /api/stores/:id/returns?status=&page=&limit= . */
export const returnListQuerySchema = z.object({
  status: z.enum(RETURN_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ReturnListQuery = z.output<typeof returnListQuerySchema>;

// -------------------------------------------------------------------------------------------------------------- the wire

/** A return as the seller dashboard reads it (the old shape plus the Sprint 5 fields, all optional so an older row still parses). */
export const returnSchema = z.object({
  id: objectIdSchema,
  order: objectIdSchema,
  store: objectIdSchema,
  customer: objectIdSchema.nullable().optional(),
  reason: z.enum(RETURN_REASONS),
  description: z.string().nullable().optional(),
  images: z.array(objectIdSchema),
  status: z.enum(RETURN_STATUSES),
  refundType: z.enum(REFUND_TYPES).nullable().optional(),
  refundAmount: z.number().min(0).nullable().optional(),
  returnNumber: z.string().nullable().optional(),
  orderNumber: z.string().nullable().optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

/** PATCH /api/returns/:id (legacy, Sprint 4). Only these three fields may change; at least one is required. */
export const returnStatusUpdateSchema = z
  .object({
    status: z.enum(RETURN_STATUSES).optional(),
    refundType: z.enum(REFUND_TYPES).optional(),
    refundAmount: z.number().min(0).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'at least one field is required' });

export type Return = z.infer<typeof returnSchema>;
export type ReturnStatusUpdate = z.infer<typeof returnStatusUpdateSchema>;

export interface ReturnItemView {
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  quantity: number;
  unitPrice: number;
}

export interface ReturnReceivedView {
  productId: string;
  variantId: string;
  quantity: number;
  restock: boolean;
}

export interface ReturnRefundView {
  amount: number;
  method: RefundMethod;
  reference: string | null;
  at: string;
  by: string | null;
}

/** The seller's view of one return (list row and detail). The customer's phone is the seller's own data about their customer. */
export interface SellerReturn {
  id: string;
  returnNumber: string | null;
  orderId: string;
  orderNumber: string | null;
  status: ReturnStatus;
  reasonCode: ReturnReason;
  note: string | null;
  rejectReason: string | null;
  contactPhone: string | null;
  customerName: string | null;
  items: ReturnItemView[];
  received: ReturnReceivedView[];
  refunds: ReturnRefundView[];
  /** Whole rupees recorded so far (the running total). */
  refundAmount: number;
  /** The most that can be refunded for what was returned (null until something was received): the paid value, delivery excluded. */
  refundCap: number | null;
  paymentMethod: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface SellerReturnList {
  docs: SellerReturn[];
  totalDocs: number;
  totalPages: number;
  page: number;
  limit: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  /** Returns per status for the tabs (the store's own). */
  counts: Record<string, number>;
}

/** One line a shopper may return: what was delivered and how many can still be asked for. */
export interface ReturnableLine {
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  unitPrice: number;
  deliveredQuantity: number;
  returnableQuantity: number;
}

/** GET .../orders/:number/return-eligibility?phone= . No name, address or phone comes back. */
export interface ReturnEligibility {
  eligible: boolean;
  reason: ReturnIneligibleReason | null;
  windowDays: number;
  deliveredAt: string | null;
  windowEndsAt: string | null;
  lines: ReturnableLine[];
}

/** 201 from POST .../returns. */
export interface ReturnCreated {
  returnNumber: string;
  status: 'requested';
}
