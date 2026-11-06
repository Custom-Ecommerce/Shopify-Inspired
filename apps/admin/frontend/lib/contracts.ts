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
export const { adminSellerListEnvelopeSchema, adminSyncOutboxSchema, adminAuditListSchema } = contracts;
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
export const {
  adminCategorySchema,
  adminCategoryListSchema,
  adminCategoryCreateRequestSchema,
  adminCategoryUpdateRequestSchema,
  adminCategoryDeleteResponseSchema,
  ADMIN_CATEGORY_NAME_MAX,
  ADMIN_CATEGORY_SLUG_MAX,
  ADMIN_CATEGORY_DESCRIPTION_MAX,
  ADMIN_CATEGORY_ORDER_MAX,
  ADMIN_CATEGORY_SLUG_PATTERN,
} = contracts;
export type {
  AdminCategory,
  AdminCategoryList,
  AdminCategoryCreateRequest,
  AdminCategoryUpdateRequest,
  AdminCategoryDeleteResponse,
} from "@markaz/contracts";
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
} = contracts;
export type {
  AdminPlatformSettings,
  AdminSettingsResponse,
  AdminSettingsUpdateRequest,
  AdminSettingsUpdateResponse,
} from "@markaz/contracts";

export const { adminOverviewSchema, ADMIN_OVERVIEW_NEW_SELLER_DAYS } = contracts;
export type { AdminOverview } from "@markaz/contracts";
