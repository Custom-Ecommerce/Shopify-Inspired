import { NextResponse } from 'next/server';
import { PolicyConfigError, PolicyDeniedError, RateLimitedError, SessionRejectedError } from '@/lib/services';

/** An error that maps directly to an HTTP status. Sprint 4: an optional code (ACCOUNT_CODES in contracts) and field. */
export class HttpError extends Error {
  readonly status: number;
  readonly errorCode: string | undefined;
  readonly errorField: string | undefined;

  constructor(status: number, message: string, code?: string, field?: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.errorCode = code;
    this.errorField = field;
  }
}

/** Sprint 6 EP-14 (D-118): the body of a refused add. See lib/plan.ts (assertWithinPlan). */
export interface PlanLimitBody {
  code: 'PLAN_LIMIT_REACHED';
  limitKind: 'products' | 'stores' | 'customDomain' | 'premiumThemes' | 'staffSeats';
  limit: number;
  used: number;
  plan: string;
  upgradeHint: string;
}

/** A refused add: 403 { errors: [{ message }], code PLAN_LIMIT_REACHED, limitKind, limit, used, plan, upgradeHint }. */
export class PlanLimitError extends HttpError {
  readonly body: PlanLimitBody;

  constructor(body: PlanLimitBody, message: string) {
    super(403, message, 'PLAN_LIMIT_REACHED');
    this.name = 'PlanLimitError';
    this.body = body;
  }
}

/** Sprint 6 EP-14 (S6-B4): what a downgrade would break, one entry per limit the seller's use passes. */
export interface DowngradeExceedsEntry {
  limit: 'stores' | 'products' | 'staffSeats' | 'apiKeys';
  allowed: number;
  used: number;
}

/** A refused downgrade: 422 { errors: [{ message }], code DOWNGRADE_EXCEEDS_LIMITS, exceeds: [{ limit, allowed, used }] }. */
export class DowngradeExceedsError extends HttpError {
  readonly exceeds: DowngradeExceedsEntry[];

  constructor(exceeds: DowngradeExceedsEntry[], message: string) {
    super(422, message, 'DOWNGRADE_EXCEEDS_LIMITS');
    this.name = 'DowngradeExceedsError';
    this.exceeds = exceeds;
  }
}

/** Payload-compatible error envelope: { errors: [{ message }] }, plus code and field when the error names them. */
export function jsonError(status: number, message: string, code?: string, field?: string): NextResponse {
  return NextResponse.json(
    { errors: [{ message }], ...(code === undefined ? {} : { code }), ...(field === undefined ? {} : { field }) },
    { status },
  );
}

/** 429 with Retry-After (EP-08 account limits, D-081). */
export function tooManyRequests(retryAfterSeconds: number): NextResponse {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  return NextResponse.json(
    { errors: [{ message: 'Too many attempts. Please wait and try again.' }], code: 'RATE_LIMITED', retryAfterSeconds: seconds },
    { status: 429, headers: { 'Retry-After': String(seconds), 'Cache-Control': 'no-store' } },
  );
}

export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

/** Clamps a query-string integer into [min, max], falling back when absent or invalid. */
export function parseIntParam(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null || raw.trim() === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Translates thrown errors into responses. Anything unrecognised is a 500 with no detail. */
export function handleRouteError(err: unknown): NextResponse {
  if (err instanceof PlanLimitError) return NextResponse.json({ errors: [{ message: err.message }], ...err.body }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  if (err instanceof DowngradeExceedsError) {
    return NextResponse.json({ errors: [{ message: err.message }], code: err.errorCode, exceeds: err.exceeds }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
  }
  if (err instanceof HttpError) return jsonError(err.status, err.message, err.errorCode, err.errorField);
  if (err instanceof SessionRejectedError) return jsonError(401, err.message, err.code);
  if (err instanceof RateLimitedError) return tooManyRequests(err.retryAfterSeconds);
  if (err instanceof PolicyDeniedError) return jsonError(403, 'You do not have permission to perform this action');
  if (err instanceof PolicyConfigError) return jsonError(501, 'This resource is not available yet');
  console.error('[seller-backend] unhandled route error', err);
  return jsonError(500, 'Internal server error');
}
