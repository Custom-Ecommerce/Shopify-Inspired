import * as contractsNs from "@markaz/contracts";
import { unwrapCjs } from "@/lib/cjs";

const contracts = unwrapCjs(contractsNs);

export const { loginRequestSchema, sessionUserSchema, authResponseSchema } = contracts;
export const {
  adminStoreListEnvelopeSchema,
  adminStoreDetailSchema,
  storeStatusChangeRequestSchema,
  storeStatusChangeResponseSchema,
  GOVERNANCE_REASON_MIN,
  GOVERNANCE_REASON_MAX,
  GOVERNANCE_NOTE_MAX,
} = contracts;
export const { adminSellerListEnvelopeSchema, adminSyncOutboxSchema, adminAuditListSchema, adminSellerStatusResponseSchema } = contracts;
export type { AdminSellerStatusResponse } from "@markaz/contracts";
// Sprint 6 EP-12.US02: the seller store limit (override, effective limit and its source).
export const { adminSellerStoreLimitSchema, adminSellerStoreLimitSetResponseSchema, sellerStoreLimitRequestSchema, STORE_LIMIT_OVERRIDE_MAX } = contracts;
export type { AdminSellerStoreLimit, AdminSellerStoreLimitSetResponse } from "@markaz/contracts";
export type { SessionUser, LoginRequest } from "@markaz/contracts";
export type {
  AdminStoreListItem,
  AdminStoreDetail,
  AdminStoreAuditEntry,
  AdminStoreListEnvelope,
  StoreStatusChangeRequest,
  StoreStatusChangeResponse,
  GovernanceStatus,
} from "@markaz/contracts";
export type {
  AdminSellerListItem,
  AdminSellerListEnvelope,
  AdminSyncEvent,
  AdminSyncOutbox,
  AdminSyncStatus,
  AdminAuditEntry,
  AdminAuditList,
} from "@markaz/contracts";

export const { adminLedgerListSchema, adminCommissionRatesSchema, adminSubscriptionPlanListSchema } = contracts;
export type {
  AdminLedgerEntry,
  AdminLedgerList,
  AdminCommissionRateItem,
  AdminCommissionRates,
  AdminSubscriptionPlan,
  AdminSubscriptionPlanList,
} from "@markaz/contracts";

export const {
  adminPlatformSettingsSchema,
  adminSettingsResponseSchema,
  adminSettingsUpdateRequestSchema,
  adminSettingsUpdateResponseSchema,
  ADMIN_SETTINGS_RATE_MIN,
  ADMIN_SETTINGS_RATE_MAX,
  ADMIN_SETTINGS_MAX_STORES_MIN,
  ADMIN_SETTINGS_MAX_STORES_MAX,
  ADMIN_SETTINGS_NOTE_MAX,
  ADMIN_SETTINGS_REASON_MAX,
  ADMIN_SETTINGS_PAYMENT_INSTRUCTIONS_MAX,
  ADMIN_SETTINGS_GRACE_DAYS_MIN,
  ADMIN_SETTINGS_GRACE_DAYS_MAX,
  ADMIN_SETTINGS_TRIAL_DAYS_MIN,
  ADMIN_SETTINGS_TRIAL_DAYS_MAX,
  ADMIN_SETTINGS_SUPPORT_EMAIL_MAX,
  ADMIN_SETTINGS_SUPPORT_PHONE_MAX,
} = contracts;
export type {
  AdminPlatformSettings,
  AdminSettingsResponse,
  AdminSettingsUpdateRequest,
  AdminSettingsUpdateResponse,
} from "@markaz/contracts";

export const {
  moderationProductListSchema,
  moderationProductSchema,
  moderationPermanentDeleteResponseSchema,
  moderationTakedownRequestSchema,
  moderationRestoreRequestSchema,
  moderationDeleteRequestSchema,
  moderationPermanentDeleteRequestSchema,
  MODERATION_REASON_MIN,
  MODERATION_REASON_MAX,
} = contracts;
export type { ModerationProduct, ModerationProductList, ModerationPermanentDeleteResponse, ModerationStatus } from "@markaz/contracts";

export const { adminOverviewSchema, ADMIN_OVERVIEW_NEW_SELLER_DAYS } = contracts;
export type { AdminOverview } from "@markaz/contracts";

// Sprint 4 EP-05.US03, US06: payouts and the commission report.
export const { payoutBalanceListSchema, payoutListSchema, payoutRowSchema, payoutFullDetailsSchema, commissionReportSchema, EARNINGS_PERIODS } = contracts;
export type {
  CommissionReport,
  EarningsPeriod,
  PayoutBalanceList,
  PayoutBalanceRow,
  PayoutFullDetails,
  PayoutList,
  PayoutRow,
  PayoutStatusValue,
} from "@markaz/contracts";

// Sprint 6 EP-14 (D-118): subscription plans are data (create, update, archive).
export const { createPlanRequestSchema, updatePlanRequestSchema, archivePlanRequestSchema, adminPlanWriteResponseSchema } = contracts;
export type { AdminPlanWriteResponse } from "@markaz/contracts";

// Sprint 6 EP-14.US02: the plan, status and usage of a seller (the sellers page).
export const { adminSellerPlansResponseSchema, EFFECTIVE_PLAN_STATUSES } = contracts;
export type { AdminSellerPlan, AdminSellerPlansResponse, EffectivePlanStatus } from "@markaz/contracts";
