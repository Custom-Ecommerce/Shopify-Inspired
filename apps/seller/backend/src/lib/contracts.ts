import { unwrapCjs } from '@/lib/cjs';
import * as contractsNs from '@markaz/contracts';

// @markaz/contracts is CommonJS. Its exports are read through the default object, the same way the
// receiver and digest routes do, so the ES module test runner and the Next bundler agree.
const contracts = unwrapCjs(contractsNs) as typeof contractsNs;

export const { MEDIA_VIDEO_FORMATS, MEDIA_VIDEO_MAX_BYTES, MEDIA_VIDEO_MAX_SECONDS, MEDIA_VIDEO_MIME_TYPES } = contracts;

export const {
  objectIdSchema,
  loginRequestSchema,
  signupRequestSchema,
  domainConnectRequestSchema,
  domainVerifyRequestSchema,
  stripeOnboardRequestSchema,
} = contracts;

// B10.0 contracts for the commerce routes.
export const { createDiscountSchema, updateDiscountSchema, reviewStatusUpdateSchema } = contracts;

// EP-15: the discount rules and what a shopper is told.
export const { discountDatesProblem, discountRefusalMessage, discountValueProblem } = contracts;

// B10.2 contracts: returns.
export const { returnStatusUpdateSchema, RETURN_TRANSITIONS } = contracts;

// B10.3 contracts: media.
export const { mediaUploadFieldsSchema } = contracts;

// PB-7: admin moderation.
export const {
  moderationDeleteRequestSchema,
  moderationPermanentDeleteRequestSchema,
  moderationProductListQuerySchema,
  moderationRestoreRequestSchema,
  moderationTakedownRequestSchema,
} = contracts;

// B10.4 contracts: analytics periods and the article option sets.
export const { ANALYTICS_PERIODS, ARTICLE_TYPES, ARTICLE_STATUSES } = contracts;
// Track B contracts: the public storefront API.
export const {
  STOREFRONT_PRODUCTS_DEFAULT_LIMIT,
  STOREFRONT_PRODUCTS_MAX_LIMIT,
  STOREFRONT_PRODUCTS_MAX_PAGE,
  STOREFRONT_SEARCH_MAX_LENGTH,
  STOREFRONT_PRODUCT_SORTS,
  STOREFRONT_STORE_LOOKUPS,
  STOREFRONT_SLUG_PATTERN,
  STOREFRONT_DOMAIN_PATTERN,
  STOREFRONT_CATEGORY_SLUG_PATTERN,
  storefrontStoreSchema,
  storefrontProductSummarySchema,
  storefrontProductListResponseSchema,
} = contracts;

// Part 7 contracts: product detail, checkout, and order tracking.
export const {
  STOREFRONT_PRODUCT_SLUG_PATTERN,
  STOREFRONT_IDEMPOTENCY_KEY_PATTERN,
  STOREFRONT_ORDER_MAX_LINES,
  STOREFRONT_ORDER_MAX_QTY,
  STOREFRONT_PAYMENT_METHODS,
  STOREFRONT_ORDER_STATUSES,
  storefrontProductDetailSchema,
  storefrontProductDetailResponseSchema,
  storefrontCheckoutCustomerSchema,
  storefrontCreateOrderRequestSchema,
  storefrontOrderCreatedSchema,
  storefrontOrderCreatedResponseSchema,
  storefrontOrderLookupRequestSchema,
  storefrontOrderSchema,
  storefrontOrderLookupResponseSchema,
} = contracts;

// Product options and variants: the write contract and the title rule.
export const { productVariantsInputSchema, variantTitle } = contracts;

// The seller's product CRUD contracts.
export const {
  PRODUCT_DEFAULT_VARIANT_FIELDS,
  PRODUCT_LIST_SORTS,
  PRODUCT_LIST_STATUSES,
  PRODUCT_SLUG_MAX,
  PRODUCT_TRASH_RETENTION_DAYS,
  inventoryAdjustRequestSchema,
  productCreateRequestSchema,
  productUpdateRequestSchema,
} = contracts;

// Store categories: the seller's CRUD contracts and the public storefront list.
export const {
  CATEGORY_ORDER_MAX,
  CATEGORY_SLUG_MAX,
  categoryCreateRequestSchema,
  categoryUpdateRequestSchema,
  storefrontCategoryListResponseSchema,
} = contracts;

// Cart quote contracts.
export const { storefrontCartQuoteRequestSchema, storefrontCartQuoteResponseSchema } = contracts;

// EP-03 CB-1: the one phone rule and the one way a catalog number becomes a price.
export const { normalizePhoneE164, toWholeRupees, STOCK_WARNING_THRESHOLD, storefrontOrderConfirmationRequestSchema } = contracts;

// PB-7: bulk import and duplicate.
export const { PRODUCT_CSV_COLUMNS, PRODUCT_IMPORT_MAX_BYTES, PRODUCT_IMPORT_MAX_ROWS, PRODUCT_TITLE_MAX } = contracts;

// EP-02 OB-1b: the seller dashboard order list and detail.
export const { DASHBOARD_ORDER_STATUSES, dashboardOrderListQuerySchema, orderListDaySchema } = contracts;

// EP-02 OB-2: the order status workflow and the transition request.
export const { canTransition, nextStatuses, transitionRefusal, ORDER_TRANSITION_REFUSAL_MESSAGES, orderTransitionRequestSchema } = contracts;

// EP-02 OB-3: cancel.
export const { canCancel, cancelRefusal, ORDER_CANCEL_REFUSAL_MESSAGES, orderCancelRequestSchema } = contracts;

// EP-02 OB-4: the tracking edit and customer tracking.
export const { orderTrackingRequestSchema, storefrontOrderTrackingSchema, storefrontOrderTrackingResponseSchema } = contracts;

// EP-02 OB-5a: payment, notes and the timeline.
export const { buildOrderTimeline, canMarkCollected, cardPaymentPending, paidCardOrder, orderNoteRequestSchema, orderPaymentRequestSchema, paymentRefusal } = contracts;

// Sprint 4 EP-07: seller alerts and the email switches.
export const { notificationPrefsUpdateSchema, readNotificationPrefs, SELLER_ALERT_PAGE_DEFAULT, SELLER_ALERT_PAGE_MAX } = contracts;

// EP-02 OB-5b: print data.
export const { labelCodAmount, ORDER_PRINT_MAX_IDS, orderPrintResponseSchema } = contracts;

// Sprint 4 EP-08: seller account and auth.
export const {
  ACCOUNT_CODES,
  FORGOT_PASSWORD_MESSAGE,
  forgotPasswordRequestSchema,
  resetPasswordRequestSchema,
  verifyEmailRequestSchema,
  accountProfileUpdateSchema,
  passwordChangeRequestSchema,
  emailChangeRequestSchema,
  sellerAccountStatusRequestSchema,
  internalAccountStatusRequestSchema,
  internalStoreLimitRequestSchema,
} = contracts;

// Sprint 4 EP-04: store settings, delivery, payments, payout, readiness and go-live.
export const {
  storeSettingsUpdateSchema,
  storeSettingsSchema,
  maskAccountNumber,
  matchPakistanCity,
  cityKey,
  quoteDelivery,
  deliveryRateFor,
  STORE_READINESS_ITEMS,
  CARD_CHECKOUT_UNSUPPORTED_BY_THEME,
  CARD_CHECKOUT_UNSUPPORTED_MESSAGE,
  CARD_CHECKOUT_UNSUPPORTED_THEME_MESSAGE,
} = contracts;

// Sprint 4 EP-05.US03, US04, US06: earnings, payouts and the commission report.
export const {
  EARNINGS_PAGE_DEFAULT_LIMIT,
  PAYOUT_CODES,
  commissionReportQuerySchema,
  createPayoutRequestSchema,
  earningsQuerySchema,
  finishPayoutRequestSchema,
  karachiDayLabel,
  payoutBalanceListQuerySchema,
  payoutDetailsRequestSchema,
  payoutListQuerySchema,
  resolvePeriod,
  voidPayoutRequestSchema,
} = contracts;

// Sprint 4 EP-07.US04 (D-092): customers and email broadcasts.
export const {
  BROADCAST_CODES,
  BROADCAST_RECIPIENT_CAP,
  broadcastListQuerySchema,
  broadcastPreviewRequestSchema,
  createBroadcastRequestSchema,
  customerListQuerySchema,
  unsubscribeRequestSchema,
} = contracts;

// Sprint 5 EP-10 (D-107): customers derived from orders, their notes, the detail and the CSV export.
export const {
  CUSTOMER_CSV_COLUMNS,
  CUSTOMER_DETAIL_ADDRESSES_MAX,
  CUSTOMER_DETAIL_ORDERS_MAX,
  CUSTOMER_EXPORT_MAX_ROWS,
  CUSTOMER_NOTE_MAX,
  customerExportQuerySchema,
  customerNoteRequestSchema,
  normalizeCustomerKey,
} = contracts;

// Sprint 5 EP-11 (D-107, D-108): phone confirmation, risk rules, the blocklist and the address book.
export const {
  ADDRESS_BOOK_MAX,
  ADDRESS_BOOK_SCAN_MAX,
  BLOCKLIST_MAX,
  BLOCK_KINDS,
  COD_CONFIRMATION_MODES,
  CONFIRMATION_LOG_MAX,
  CONFIRMATION_STATUSES,
  CONTACT_BLOCKED,
  CONTACT_BLOCKED_MESSAGE,
  DEFAULT_FRAUD_SETTINGS,
  NO_USABLE_PAYMENT_METHOD,
  NO_USABLE_PAYMENT_METHOD_MESSAGE,
  ORDER_CONFIRMATION_DECIDED,
  ORDER_NOT_CONFIRMED,
  ORDER_NOT_CONFIRMED_MESSAGE,
  RISK_FLAGS,
  SELLER_ALERT_KINDS,
  assessOrderRisk,
  blockedContactRequestSchema,
  normalizeBlockValue,
  orderConfirmationRequestSchema,
  readConfirmationStatus,
  readRiskFlags,
} = contracts;

// Sprint 5 EP-13 (D-107, D-108, D-109): returns, refunds and the arithmetic behind them.
export const {
  CARD_REFUND_UNSUPPORTED,
  CARD_REFUND_UNSUPPORTED_MESSAGE,
  RETURN_ITEMS_MAX,
  RETURN_REASON_LABELS,
  RETURN_STATUSES,
  RETURN_WINDOW_DAYS_DEFAULT,
  commissionReversal,
  discountShare,
  everythingReceived,
  grossOf,
  refundRoom,
  returnCreateRequestSchema,
  returnLineKey,
  returnListQuerySchema,
  returnReceiveRequestSchema,
  returnRefundRequestSchema,
  returnRejectRequestSchema,
  returnWindow,
  returnableQuantities,
  returnedBase,
} = contracts;

// Sprint 5 EP-21 (D-107, D-108): reviews of delivered orders, the seller's reply and the admin's hide.
export const {
  REVIEW_ALREADY_REPLIED,
  REVIEW_BODY_MAX,
  REVIEW_DEFAULT_DISPLAY_NAME,
  REVIEW_INELIGIBLE_MESSAGES,
  REVIEW_NOT_ELIGIBLE,
  REVIEW_NOT_REPLIED,
  REVIEW_PAGE_DEFAULT_LIMIT,
  REVIEW_STATUS_CHANGED,
  cleanReviewText,
  productReviewsQuerySchema,
  reviewCreateRequestSchema,
  reviewHideRequestSchema,
  reviewModerationListQuerySchema,
  reviewReplyRequestSchema,
  reviewUnhideRequestSchema,
  sellerReviewListQuerySchema,
} = contracts;

// Sprint 5 EP-28 (D-107): abandoned carts.
export const {
  ABANDONED_CART_CONSENT_LINE,
  ABANDONED_CART_EMAIL_DELAY_MS,
  ABANDONED_CART_ITEMS_MAX,
  ABANDONED_CART_NOT_FOUND,
  ABANDONED_CART_STATUS_CHANGED,
  ABANDONED_CART_TTL_DAYS,
  abandonedCartContactedRequestSchema,
  abandonedCartListQuerySchema,
  abandonedCartRequestSchema,
} = contracts;
