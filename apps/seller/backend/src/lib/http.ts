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
  if (err instanceof HttpError) return jsonError(err.status, err.message, err.errorCode, err.errorField);
  if (err instanceof SessionRejectedError) return jsonError(401, err.message, err.code);
  if (err instanceof RateLimitedError) return tooManyRequests(err.retryAfterSeconds);
  if (err instanceof PolicyDeniedError) return jsonError(403, 'You do not have permission to perform this action');
  if (err instanceof PolicyConfigError) return jsonError(501, 'This resource is not available yet');
  console.error('[seller-backend] unhandled route error', err);
  return jsonError(500, 'Internal server error');
}
