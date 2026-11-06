import { NextResponse } from 'next/server';
import { PolicyConfigError, PolicyDeniedError } from '@/lib/services';

/** An error that maps directly to an HTTP status. */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** Payload-compatible error envelope: { errors: [{ message }] }. */
export function jsonError(status: number, message: string): NextResponse {
  return NextResponse.json({ errors: [{ message }] }, { status });
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
  if (err instanceof HttpError) return jsonError(err.status, err.message);
  if (err instanceof PolicyDeniedError) return jsonError(403, 'You do not have permission to perform this action');
  if (err instanceof PolicyConfigError) return jsonError(501, 'This resource is not available yet');
  console.error('[seller-backend] unhandled route error', err);
  return jsonError(500, 'Internal server error');
}
