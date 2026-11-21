import { z } from 'zod';
import { objectIdSchema } from './object-id';

/**
 * Sprint 5 EP-21 (D-107, D-108): reviews of delivered orders. status keeps its three values with new meanings:
 *   approved  shown on the storefront (a new review starts here: it is published at once)
 *   rejected  hidden by an admin, with a reason
 *   pending   no longer used
 * A review is plain text only, kept as typed (see cleanReviewText), and every output escapes what it prints.
 */
export const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_RATING_MIN = 1;
export const REVIEW_RATING_MAX = 5;
export const REVIEW_TITLE_MAX = 80;
export const REVIEW_BODY_MIN = 5;
export const REVIEW_BODY_MAX = 1000;
export const REVIEW_DISPLAY_NAME_MAX = 40;
export const REVIEW_REPLY_MAX = 500;
export const REVIEW_HIDE_REASON_MIN = 3;
export const REVIEW_HIDE_REASON_MAX = 300;
/** What the display name reads as when the shopper left it empty. */
export const REVIEW_DEFAULT_DISPLAY_NAME = 'Customer';
export const REVIEW_PAGE_DEFAULT_LIMIT = 10;
export const REVIEW_PAGE_MAX_LIMIT = 50;

/** The error codes of the public review routes and the seller reply routes. */
export const REVIEW_NOT_ELIGIBLE = 'REVIEW_NOT_ELIGIBLE';
export const REVIEW_ALREADY_REPLIED = 'REVIEW_ALREADY_REPLIED';
export const REVIEW_NOT_REPLIED = 'REVIEW_NOT_REPLIED';
export const REVIEW_STATUS_CHANGED = 'REVIEW_STATUS_CHANGED';

/** Why a shopper cannot review (the eligibility answer, and the reason of a 422 REVIEW_NOT_ELIGIBLE). */
export const REVIEW_INELIGIBLE_REASONS = ['not_delivered', 'nothing_to_review', 'already_reviewed', 'unknown_product'] as const;
export type ReviewIneligibleReason = (typeof REVIEW_INELIGIBLE_REASONS)[number];

export const REVIEW_INELIGIBLE_MESSAGES: Readonly<Record<ReviewIneligibleReason, string>> = {
  not_delivered: 'You can review the items once this order has been delivered.',
  nothing_to_review: 'Every item of this order has already been reviewed.',
  already_reviewed: 'You have already reviewed this item.',
  unknown_product: 'This item is not part of the order.',
};

/**
 * A pasted text is cleaned, never refused: line breaks stay, other control characters go, the ends are trimmed. Like every shopper text on
 * the platform (see the checkout contract) it is PLAIN TEXT kept as typed: "<b>" is three characters, not markup, and every output that
 * shows it escapes it (React text nodes, and the email templates, which escape each value).
 */
export function cleanReviewText(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

const plain = () => z.string().transform(cleanReviewText);

/** The product as the reviews page reads it: the ObjectId, or the populated product (depth 1). */
const populatedProduct = z.object({
  id: objectIdSchema,
  title: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
});

const replySchema = z.object({
  text: z.string(),
  at: z.string().datetime({ offset: true }),
  editedAt: z.string().datetime({ offset: true }).nullable().optional(),
});

/** The Reviews collection (apps/admin/src/collections/Reviews.ts). */
export const reviewSchema = z.object({
  id: objectIdSchema,
  product: z.union([objectIdSchema, populatedProduct]),
  store: objectIdSchema,
  customer: objectIdSchema.nullable().optional(),
  order: objectIdSchema.nullable().optional(),
  rating: z.number().int().min(1).max(5),
  title: z.string().nullable().optional(),
  body: z.string().min(1),
  status: z.enum(REVIEW_STATUSES).nullable().optional(),
  displayName: z.string().nullable().optional(),
  verified: z.boolean().optional(),
  reply: replySchema.nullable().optional(),
  hiddenReason: z.string().nullable().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type Review = z.infer<typeof reviewSchema>;

/**
 * A review kept after its product was permanently deleted (D-014, A-004). Strict on purpose: a customer, an order, a
 * phone or an address cannot be added to this shape by accident.
 */
export const archivedReviewSchema = z
  .object({
    id: objectIdSchema,
    rating: z.number().int().min(1).max(5),
    title: z.string().nullable(),
    body: z.string().min(1),
    reviewedAt: z.string().datetime({ offset: true }),
    product: z.object({ title: z.string().min(1), slug: z.string().min(1), store: objectIdSchema }).strict(),
    archivedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type ArchivedReview = z.infer<typeof archivedReviewSchema>;

/**
 * The old shape of PATCH /api/reviews/:id: the moderation status. Sprint 5 (D-108) takes it away from the seller: the route now takes only
 * a reply (reviewReplyRequestSchema), and hiding a review is the admin's (reviewHideRequestSchema). Kept exported for the admin console.
 */
export const reviewStatusUpdateSchema = z
  .object({
    status: z.enum(REVIEW_STATUSES),
  })
  .strict();

export type ReviewStatusUpdate = z.infer<typeof reviewStatusUpdateSchema>;

// ------------------------------------------------------------------------------------------------------- the shopper's side

/** GET .../orders/:number/review-eligibility: the delivered products of the order that have no review yet. No name, phone or address comes back. */
export const reviewEligibilitySchema = z.object({
  eligible: z.boolean(),
  reason: z.enum(REVIEW_INELIGIBLE_REASONS).nullable(),
  items: z.array(z.object({ productId: z.string().min(1), productTitle: z.string() })),
});

export type ReviewEligibility = z.output<typeof reviewEligibilitySchema>;

/** POST .../orders/:number/reviews. The credential is the order number (in the path) plus the phone. */
export const reviewCreateRequestSchema = z
  .object({
    phone: z.string().trim().min(1, 'Enter the phone number of the order.').max(32),
    productId: objectIdSchema,
    rating: z.number().int().min(REVIEW_RATING_MIN, 'Choose a rating from 1 to 5.').max(REVIEW_RATING_MAX, 'Choose a rating from 1 to 5.'),
    title: plain().pipe(z.string().max(REVIEW_TITLE_MAX, 'The title can be at most ' + REVIEW_TITLE_MAX + ' characters.')).nullish(),
    body: plain()
      .pipe(z.string().min(REVIEW_BODY_MIN, 'Write at least ' + REVIEW_BODY_MIN + ' characters.'))
      .pipe(z.string().max(REVIEW_BODY_MAX, 'The review can be at most ' + REVIEW_BODY_MAX + ' characters.')),
    displayName: plain().pipe(z.string().max(REVIEW_DISPLAY_NAME_MAX, 'The name can be at most ' + REVIEW_DISPLAY_NAME_MAX + ' characters.')).nullish(),
  })
  .strict();

export type ReviewCreateRequest = z.output<typeof reviewCreateRequestSchema>;

export const reviewCreatedSchema = z.object({ id: z.string().min(1), status: z.literal('approved') });
export type ReviewCreated = z.output<typeof reviewCreatedSchema>;

/** One review as the storefront shows it. No customer, order, phone, email or status leaves with it. */
export const publicReviewSchema = z.object({
  id: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  title: z.string().nullable(),
  body: z.string(),
  displayName: z.string(),
  verified: z.boolean(),
  createdAt: z.string(),
  reply: z.object({ text: z.string(), at: z.string() }).nullable(),
});

export type PublicReview = z.output<typeof publicReviewSchema>;

/** GET .../products/:slug/reviews?page=&limit= : approved reviews, newest first, with the average and the count of ALL approved ones. */
export const productReviewsResponseSchema = z.object({
  data: z.object({
    reviews: z.array(publicReviewSchema),
    summary: z.object({ average: z.number().min(0).max(5), count: z.number().int().min(0) }),
  }),
  page: z.number().int().min(1),
  totalPages: z.number().int().min(0),
});

export type ProductReviewsResponse = z.output<typeof productReviewsResponseSchema>;

export const productReviewsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(REVIEW_PAGE_MAX_LIMIT).default(REVIEW_PAGE_DEFAULT_LIMIT),
  })
  .strict();

// ------------------------------------------------------------------------------------------------------- the seller's side

/** The list filters: ?status= and ?unanswered=1 and the page. Anything else is refused. */
export const sellerReviewListQuerySchema = z
  .object({
    status: z.enum(REVIEW_STATUSES).optional(),
    unanswered: z.enum(['1']).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type SellerReviewListQuery = z.output<typeof sellerReviewListQuerySchema>;

/** POST /api/reviews/:id/reply and PATCH /api/reviews/:id: the seller's one reply, up to 500 characters. */
export const reviewReplyRequestSchema = z
  .object({
    reply: plain().pipe(z.string().min(1, 'Write a reply.')).pipe(z.string().max(REVIEW_REPLY_MAX, 'The reply can be at most ' + REVIEW_REPLY_MAX + ' characters.')),
  })
  .strict();

export type ReviewReplyRequest = z.output<typeof reviewReplyRequestSchema>;

/** A review as the seller reads it. Built field by field: no customer, order, phone or email. */
export interface SellerReview {
  id: string;
  product: { id: string; title: string | null; slug: string | null };
  rating: number;
  title: string | null;
  body: string;
  displayName: string;
  verified: boolean;
  status: ReviewStatus;
  reply: { text: string; at: string; editedAt: string | null } | null;
  hiddenReason: string | null;
  createdAt: string;
}

// ------------------------------------------------------------------------------------------------------- the admin's side

export const reviewHideReasonSchema = plain()
  .pipe(z.string().min(REVIEW_HIDE_REASON_MIN, 'Give a reason of at least ' + REVIEW_HIDE_REASON_MIN + ' characters.'))
  .pipe(z.string().max(REVIEW_HIDE_REASON_MAX, 'The reason can be at most ' + REVIEW_HIDE_REASON_MAX + ' characters.'));

export const reviewHideRequestSchema = z.object({ reviewId: objectIdSchema, reason: reviewHideReasonSchema }).strict();
export const reviewUnhideRequestSchema = z.object({ reviewId: objectIdSchema }).strict();

export type ReviewHideRequest = z.output<typeof reviewHideRequestSchema>;
export type ReviewUnhideRequest = z.output<typeof reviewUnhideRequestSchema>;

export const REVIEW_MODERATION_STATUSES = ['approved', 'rejected'] as const;

export const reviewModerationListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    storeId: objectIdSchema.optional(),
    status: z.enum(REVIEW_MODERATION_STATUSES).optional(),
  })
  .strict();

export type ReviewModerationListQuery = z.output<typeof reviewModerationListQuerySchema>;

/** One review as an operator sees it: the store is named, the shopper is not (only the name they chose to show). */
export interface ModerationReview {
  reviewId: string;
  storeId: string;
  storeName: string | null;
  productId: string;
  productTitle: string | null;
  rating: number;
  title: string | null;
  body: string;
  displayName: string;
  status: 'approved' | 'rejected' | 'pending';
  hiddenReason: string | null;
  hiddenAt: string | null;
  createdAt: string;
}

export interface ModerationReviewList {
  docs: ModerationReview[];
  page: number;
  limit: number;
  totalDocs: number;
  totalPages: number;
}
