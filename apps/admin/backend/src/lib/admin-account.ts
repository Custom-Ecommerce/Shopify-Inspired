import mongoose from 'mongoose';
import { after } from 'next/server';
import * as notificationsNs from '@markaz/notifications';
import type { EnqueueInput, NotificationOutboxModel } from '@markaz/notifications';
import type { AccountFlowDeps, AccountUserModelPort, AuthRateLimiter, AuthTokenModelPort, RateCounterStore } from '@markaz/auth';
import { resolveClientIp } from '@markaz/platform-kit/client-ip';
import { verifiedClientAddress } from '@markaz/platform-kit/signed-client-address';
import * as contractsNs from '@markaz/contracts';
import { AdminHttpError } from '@/lib/admin-auth';
import { unwrapCjs } from '@/lib/cjs';
import { connectDb } from '@/lib/db';
import {
  AuthToken,
  createAuthRateLimiter,
  hashPassword,
  memoryRateCounterStore,
  mongoRateCounterStore,
  NotificationOutbox,
  RateLimitCounter,
  User,
} from '@/lib/workspace';

const notifications: typeof notificationsNs = unwrapCjs(notificationsNs);

/**
 * Sprint 4 EP-08: what the admin account routes need, kept small. The email glue mirrors the seller backend's
 * lib/notifications.ts (after() + the package's enqueue); the flows, the tokens and the limits themselves live in
 * @markaz/auth and @markaz/notifications, so nothing large is written twice.
 */

async function databaseOpen(): Promise<boolean> {
  await connectDb();
  return mongoose.connection.readyState === 1;
}

/** Runs the job after the response; outside a request (tests, scripts) at once. Only while the database is open. Never throws. */
export function runAfterResponse(label: string, job: () => Promise<unknown>): void {
  const guarded = async (): Promise<void> => {
    try {
      if (mongoose.connection.readyState !== 1) return;
      await job();
    } catch (err) {
      console.error('[admin-backend] background job failed', { job: label, error: notifications.errorText(err) });
    }
  };
  try {
    after(guarded);
  } catch {
    void guarded();
  }
}

export const outboxModel = (): NotificationOutboxModel => NotificationOutbox as unknown as NotificationOutboxModel;

export function enqueueEmail(input: EnqueueInput): Promise<unknown> {
  return notifications.enqueueNotification(outboxModel(), input, {
    schedule: (run) => {
      void run();
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Limits (D-081 shared counters)

let store: RateCounterStore = mongoRateCounterStore(RateLimitCounter as unknown as Parameters<typeof mongoRateCounterStore>[0], databaseOpen);

export const adminAuthLimiter: AuthRateLimiter = createAuthRateLimiter(() => store);

/** Test seam: in-process counters. */
export function useMemoryAdminAuthLimits(): ReturnType<typeof memoryRateCounterStore> {
  const memory = memoryRateCounterStore();
  store = memory;
  return memory;
}

/**
 * The caller's address for the per-IP limits, or null when it cannot be known (then the per-IP bucket is skipped and
 * only the account or email bucket applies, D-097: never one shared "unknown" bucket).
 *
 * First the address the console's proxy signed (x-markaz-client-address, CLIENT_ADDRESS_SIGNING_SECRET, scope
 * PORTAL_CLIENT_SCOPE): the BFF calls this backend server to server, so only it knows the browser's address. Then the
 * trusted-proxy rule (TRUSTED_PROXY_HOPS or TRUSTED_CLIENT_IP_HEADER), never a raw x-forwarded-for.
 */
export function clientAddress(headers: Headers): string | null {
  return verifiedClientAddress(headers, process.env.CLIENT_ADDRESS_SIGNING_SECRET ?? '', PORTAL_CLIENT_SCOPE) ?? resolveClientIp(headers, process.env);
}

/** The scope the seller portal and the admin console sign the browser's address for (no store is involved). */
export const PORTAL_CLIENT_SCOPE = 'account-portal';

/** Consumes the per-IP bucket only when the address is known. */
export async function consumeIp(limiter: AuthRateLimiter, rule: Parameters<AuthRateLimiter['consume']>[0], address: string | null): Promise<void> {
  if (address !== null) await limiter.consume(rule, address);
}

// ---------------------------------------------------------------------------------------------------------------------
// Account flows

/** Links in admin account emails go to the admin console (APP_BASE_URL_ADMIN). */
export function adminConsoleLink(pathAndQuery: string): string | null {
  try {
    const raw = process.env.APP_BASE_URL_ADMIN;
    if (!raw) return null;
    const root = new URL(raw);
    return root.origin + root.pathname.replace(/\/+$/, '') + pathAndQuery;
  } catch {
    return null;
  }
}

export function adminAccountDeps(): AccountFlowDeps {
  return {
    users: User as unknown as AccountUserModelPort,
    tokens: AuthToken as unknown as AuthTokenModelPort,
    hashPassword: (plain) => hashPassword(plain) as Promise<string>,
    sendEmail: (email) =>
      mongoose.connection.readyState === 1 ? enqueueEmail({ template: email.template, to: email.to, vars: email.vars, dedupeKey: email.dedupeKey }) : undefined,
    link: adminConsoleLink,
    // The admin guard reads the account on every request, so there is no cache entry to clear.
    forgetSession: () => {},
    role: 'admin',
    appName: 'Markazify admin',
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Contracts and body parsing (400 with the field name)


const contracts = unwrapCjs(contractsNs) as typeof contractsNs;
export const {
  ACCOUNT_CODES,
  FORGOT_PASSWORD_MESSAGE,
  forgotPasswordRequestSchema,
  resetPasswordRequestSchema,
  sellerAccountStatusRequestSchema,
  passwordProblem,
} = contracts;

interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string; code?: string; keys?: unknown[] }> } };
}

export async function readAdminBody<T>(request: Request, schema: Schema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AdminHttpError(400, 'Body must be JSON', ACCOUNT_CODES.BODY_INVALID, 'body');
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const unknownKey = issue?.code === 'unrecognized_keys' && Array.isArray(issue.keys) ? issue.keys[0] : undefined;
  const field = unknownKey !== undefined ? String(unknownKey) : issue && issue.path.length > 0 ? issue.path.map(String).join('.') : 'body';
  throw new AdminHttpError(400, issue?.message ?? 'Invalid request', ACCOUNT_CODES.BODY_INVALID, field);
}
