import { unwrapCjs } from '@/lib/cjs';
import * as contractsNs from '@markaz/contracts';

// @markaz/contracts is CommonJS. Its exports are read through the default object, the same way the
// receiver and digest routes do, so the ES module test runner and the Next bundler agree.
const contracts = unwrapCjs(contractsNs) as typeof contractsNs;

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

// B10.2 contracts: returns.
export const { returnStatusUpdateSchema, RETURN_TRANSITIONS } = contracts;

// B10.3 contracts: media.
export const { mediaUploadFieldsSchema } = contracts;

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
