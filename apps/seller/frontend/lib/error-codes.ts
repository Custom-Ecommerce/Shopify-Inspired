/**
 * Phase 6A — Error-code contract (Blueprint §6.8).
 *
 * Client-safe (no `server-only`): imported by the server auth/proxy layer AND
 * by client hooks, so both sides agree on the same codes and HTTP statuses.
 */

export const ERROR_CODES = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  BACKEND_OFFLINE: "BACKEND_OFFLINE",
  ACCOUNT_SUSPENDED: "ACCOUNT_SUSPENDED",
  STORE_CONTEXT_REQUIRED: "STORE_CONTEXT_REQUIRED",
  STORE_FORBIDDEN: "STORE_FORBIDDEN",
  STORE_MISMATCH: "STORE_MISMATCH",
  STORE_PENDING: "STORE_PENDING",
  STORE_SUSPENDED: "STORE_SUSPENDED",
  STORE_ARCHIVED: "STORE_ARCHIVED",
  STORE_LIMIT_REACHED: "STORE_LIMIT_REACHED",
  SLUG_TAKEN: "SLUG_TAKEN",
  SLUG_RESERVED: "SLUG_RESERVED",
  CARD_REQUIRES_STRIPE: "CARD_REQUIRES_STRIPE",
  PROVISIONING_PENDING: "PROVISIONING_PENDING",
  // Frontend-only additions (not in §6.8): used by the server layer itself.
  NO_STORES: "NO_STORES",
  FIELD_NOT_ALLOWED: "FIELD_NOT_ALLOWED",
  INVALID_BODY: "INVALID_BODY",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  FORBIDDEN: "FORBIDDEN",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Canonical HTTP status per code (§6.8). */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  BACKEND_OFFLINE: 502,
  ACCOUNT_SUSPENDED: 403,
  STORE_CONTEXT_REQUIRED: 400,
  STORE_FORBIDDEN: 403,
  STORE_MISMATCH: 400,
  STORE_PENDING: 403,
  STORE_SUSPENDED: 403,
  STORE_ARCHIVED: 403,
  STORE_LIMIT_REACHED: 409,
  SLUG_TAKEN: 409,
  SLUG_RESERVED: 422,
  CARD_REQUIRES_STRIPE: 422,
  PROVISIONING_PENDING: 202,
  NO_STORES: 403,
  FIELD_NOT_ALLOWED: 400,
  INVALID_BODY: 400,
  UPSTREAM_ERROR: 502,
  FORBIDDEN: 403,
};

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ERROR_CODES, value);
}

/** Wire format every proxy error response uses: `{ error, code, details? }`. */
export interface ApiErrorBody {
  error: string;
  code: ErrorCode | string;
  details?: unknown;
}

/** Codes the dashboard server layer throws from `lib/dashboard-auth.ts`. */
export type DashboardAuthErrorCode =
  | "UNAUTHENTICATED"
  | "BACKEND_OFFLINE"
  | "STORE_FORBIDDEN"
  | "NO_STORES"
  | "STORE_CONTEXT_REQUIRED"
  | "ACCOUNT_SUSPENDED";

/**
 * Typed error thrown by the server-side auth helpers. `message === code`, so
 * legacy `err.message === "BACKEND_OFFLINE"` checks keep working.
 */
export class DashboardAuthError extends Error {
  readonly code: DashboardAuthErrorCode;
  readonly status: number;

  constructor(code: DashboardAuthErrorCode, options?: { cause?: unknown }) {
    super(code);
    this.name = "DashboardAuthError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    if (options?.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

export function isDashboardAuthError(err: unknown): err is DashboardAuthError {
  return err instanceof DashboardAuthError;
}

/** Error surfaced to client code by `useDashboardFetch` (carries the §6.8 code). */
export class DashboardApiError extends Error {
  readonly code: ErrorCode | string | null;
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status: number, code: ErrorCode | string | null, details?: unknown) {
    super(message);
    this.name = "DashboardApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
