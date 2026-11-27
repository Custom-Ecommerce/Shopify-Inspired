import { UPGRADE_REQUIRED_CODE } from '@markaz/auth/mobile-version';

/** What a request of an app can fail with. No error ever carries a token. */

export class NetworkError extends Error {
  constructor(readonly reason: 'offline' | 'timeout') {
    super(reason === 'timeout' ? 'The server took too long to answer.' : 'No connection to the server.');
    this.name = 'NetworkError';
  }
}

export interface ApiErrorInit {
  status: number;
  code?: string | null;
  message: string;
  field?: string | null;
  body?: unknown;
  retryAfterSeconds?: number | null;
}

/** The server answered and refused (or answered something the app cannot read: code BAD_RESPONSE). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly field: string | null;
  readonly body: unknown;
  readonly retryAfterSeconds: number | null;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code ?? null;
    this.field = init.field ?? null;
    this.body = init.body;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
  }
}

/** 426: the app is older than the minimum the platform asks for. The session stays. */
export class UpgradeRequired extends ApiError {
  readonly minVersion: string | null;
  readonly storeUrl: string | null;

  constructor(body: unknown) {
    const record = asRecord(body);
    super({ status: 426, code: UPGRADE_REQUIRED_CODE, message: 'Update the app to continue.', body });
    this.name = 'UpgradeRequired';
    this.minVersion = textOf(record.minVersion);
    this.storeUrl = textOf(record.storeUrl);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Both envelopes: the seller backend answers { errors: [{ message, code? }], code?, field? } (order and product refusals put the code inside errors[0]),
 * the admin backend { error, code?, field? }.
 */
export function errorFromResponse(status: number, body: unknown, retryAfterSeconds: number | null = null): ApiError {
  if (status === 426) return new UpgradeRequired(body);
  const record = asRecord(body);
  const first = asRecord(Array.isArray(record.errors) ? record.errors[0] : null);
  return new ApiError({
    status,
    code: textOf(record.code) ?? textOf(first.code),
    message: textOf(first.message) ?? textOf(record.error) ?? textOf(record.message) ?? `The request failed (${status}).`,
    field: textOf(record.field) ?? textOf(first.field),
    body,
    retryAfterSeconds,
  });
}

/** A short sentence for a screen. */
export function errorText(error: unknown): string {
  if (error instanceof NetworkError || error instanceof ApiError) return error.message;
  return 'Something went wrong.';
}
