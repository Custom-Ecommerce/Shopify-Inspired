import { unwrapCjs } from '@/lib/cjs';
import * as authNs from '@markaz/auth';
import * as dbNs from '@markaz/db-schemas';

// The packages are CommonJS. Read their exports through the default object when it is present, the
// same way the receiver, digest, and contracts modules do, so the Next bundler and the ES module
// test runner agree.
const auth: typeof authNs = unwrapCjs(authNs);
const db: typeof dbNs = unwrapCjs(dbNs);

export const {
  hashPassword,
  verifyPassword,
  signSession,
  isLocked,
  recordFailedAttempt,
  SESSION_MIN_SECRET_LENGTH,
  SESSION_COOKIE_NAME,
  verifySession,
  PolicyConfigError,
  PolicyDeniedError,
  writeAuditLog,
} = auth;

export const User = db.User;
export const AuditLog = db.AuditLog;
export const RateLimitCounter = db.RateLimitCounter;

/**
 * Loaded on first use. @markaz/billing creates its Stripe client at import time, which needs
 * STRIPE_SECRET_KEY, so importing it eagerly would break every route that merely shares this module.
 */
export async function loadBillingPorts(): Promise<ReturnType<typeof import('@markaz/billing').getBillingPorts>> {
  const mod = await import('@markaz/billing');
  const resolved = unwrapCjs(mod);
  resolved.registerBillingPorts(db.billingPortsImpl);
  return resolved.getBillingPorts();
}

// B10.0 shims: policy, the list envelope, and the commerce models, read through the same default-object pattern.
import * as compatNs from '@markaz/api-compat';
const compat: typeof compatNs = unwrapCjs(compatNs);
export const listEnvelope = compat.listEnvelope;
export const assertCan = auth.assertCan;
// EP-02: which policy row guards each order action (D-067).
export const ORDER_ACTIONS = auth.ORDER_ACTIONS;
export const PUBLIC_CATEGORY_READABLE_FIELDS = auth.PUBLIC_CATEGORY_READABLE_FIELDS;
export const SELLER_STORE_READABLE_FIELDS = auth.SELLER_STORE_READABLE_FIELDS;
export const Discount = db.Discount;
export const Review = db.Review;

// B10.2 shims: the return and referral models.
export const Return = db.Return;
export const Referral = db.Referral;

// B10.3 shims: the category and media models.
export const Category = db.Category;
export const Media = db.Media;

// B10.4 shims: the store article and order models.
export const StoreArticle = db.StoreArticle;
export const Order = db.Order;
// Track B shims: the storefront API reads stores and the catalog.
export const Store = db.Store;
export const Product = db.Product;
export const productSkus = db.productSkus;
export const StockMovement = db.StockMovement;
export const ArchivedReview = db.ArchivedReview;
// Sprint 4 EP-07: the notification outbox and the seller's in-app alerts.
export const NotificationOutbox = db.NotificationOutbox;
export const SellerAlert = db.SellerAlert;

// Sprint 4 EP-08: account links, the per-request session guard, the account-route limits and the account flows.
export const AuthToken = db.AuthToken;
export const {
  createSessionGuard,
  toSessionUserRecord,
  sessionTokenVersion,
  SESSION_USER_FIELDS,
  SessionRejectedError,
  RateLimitedError,
  createAuthRateLimiter,
  mongoRateCounterStore,
  memoryRateCounterStore,
  LOGIN_ACCOUNT_RULE,
  LOGIN_IP_RULE,
  FORGOT_IP_RULE,
  FORGOT_EMAIL_RULE,
  RESET_IP_RULE,
  RESEND_VERIFY_RULE,
  requestPasswordReset,
  resetPassword,
  sendPasswordChanged,
  sendEmailVerification,
  requestEmailChange,
  confirmEmailToken,
} = auth;
