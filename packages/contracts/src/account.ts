import { z } from 'zod';
import { normalizePhoneE164 } from './checkout';

/*
 * Sprint 4 EP-08 (D-093): the seller account and auth requests, and the codes the routes answer with.
 */

/** The one password rule: signup, reset, change and create-admin all use it. Signup already asked for 8; 128 bounds bcrypt work. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const passwordSchema = z
  .string({ error: 'password is required' })
  .min(PASSWORD_MIN_LENGTH, 'password must be at least 8 characters')
  .max(PASSWORD_MAX_LENGTH, 'password must be at most 128 characters');

/** The same rule as a plain check, for scripts and forms: null when fine, else the message. */
export function passwordProblem(value: unknown): string | null {
  const result = passwordSchema.safeParse(value);
  return result.success ? null : (result.error.issues[0]?.message ?? 'password is not valid');
}

export const ACCOUNT_EMAIL_MAX = 254;
const emailSchema = z.string().trim().toLowerCase().max(ACCOUNT_EMAIL_MAX).email('enter a valid email address');
/** Raw account tokens are 32 bytes in base64url (43 characters); anything else is refused with the same code. */
const tokenSchema = z.string().trim().min(1, 'token is required').max(200);

/** The codes an account route answers with. */
export const ACCOUNT_CODES = {
  /** 400: an unknown, used or expired link. One code for all three, so a guess learns nothing. */
  TOKEN_INVALID: 'TOKEN_INVALID',
  /** 403: go-live and payouts need a verified email (SB-4, SB-7 call requireVerifiedEmail). */
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  /** 401 on a token request: the account is suspended or blocked. */
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  /** 401 on a token request: the account is gone, or the session was revoked (tokenVersion moved on). */
  SESSION_REVOKED: 'SESSION_REVOKED',
  /** 409: the new email belongs to another account. */
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  /** 400: the current password is wrong (account page). */
  PASSWORD_INCORRECT: 'PASSWORD_INCORRECT',
  /** 400: a request body problem; the answer names the field. */
  BODY_INVALID: 'ACCOUNT_BODY_INVALID',
  /** 429 with Retry-After. */
  RATE_LIMITED: 'RATE_LIMITED',
} as const;
export type AccountCode = (typeof ACCOUNT_CODES)[keyof typeof ACCOUNT_CODES];
export const EMAIL_NOT_VERIFIED = ACCOUNT_CODES.EMAIL_NOT_VERIFIED;

/** Forgot password always answers this, whatever happened (D-093). */
export const FORGOT_PASSWORD_MESSAGE = 'If an account exists for this email, we have sent a link to reset the password. It is valid for 30 minutes.';

export const forgotPasswordRequestSchema = z.object({ email: emailSchema }).strict();
export const resetPasswordRequestSchema = z.object({ token: tokenSchema, password: passwordSchema }).strict();
export const verifyEmailRequestSchema = z.object({ token: tokenSchema }).strict();

export const ACCOUNT_NAME_MAX = 120;

/** PATCH /api/users/me: name and phone (the shared Pakistani mobile rule; an empty phone clears it). */
export const accountProfileUpdateSchema = z
  .object({
    name: z.string().trim().min(1, 'name is required').max(ACCOUNT_NAME_MAX),
    phone: z
      .string()
      .max(32)
      .transform((value, context) => {
        if (value.trim() === '') return null;
        const phone = normalizePhoneE164(value);
        if (phone === null) {
          context.addIssue({ code: 'custom', message: 'Enter a valid mobile number, for example 0300 1234567' });
          return z.NEVER;
        }
        return phone;
      })
      .nullable(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'at least one field is required' });
export type AccountProfileUpdate = z.output<typeof accountProfileUpdateSchema>;

export const passwordChangeRequestSchema = z.object({ currentPassword: z.string().min(1, 'currentPassword is required').max(1024), newPassword: passwordSchema }).strict();
export const emailChangeRequestSchema = z.object({ password: z.string().min(1, 'password is required').max(1024), newEmail: emailSchema }).strict();

/** Admin: suspend or unsuspend a seller account. A reason is required to suspend (D-093). */
export const SELLER_SUSPEND_REASON_MAX = 300;
export const sellerAccountStatusRequestSchema = z
  .object({
    status: z.enum(['active', 'suspended']),
    reason: z.string().trim().max(SELLER_SUSPEND_REASON_MAX, 'reason must be at most 300 characters').optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === 'suspended' && (value.reason === undefined || value.reason.length < 3)) {
      context.addIssue({ code: 'custom', path: ['reason'], message: 'a reason of 3 to 300 characters is required to suspend' });
    }
  });
export type SellerAccountStatusRequest = z.output<typeof sellerAccountStatusRequestSchema>;

/** The account as /api/users/me returns it (Sprint 4 fields; older fields stay as they were). */
export const accountMeSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  pendingEmail: z.string().nullable(),
  emailVerified: z.boolean(),
  accountStatus: z.enum(['active', 'suspended', 'blocked']),
});
export type AccountMe = z.output<typeof accountMeSchema>;

/** Admin backend -> seller backend, signed (POST /api/internal/accounts/status): apply a seller account status there. */
export const internalAccountStatusRequestSchema = z
  .object({
    userId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'userId must be a 24-character ObjectId'),
    status: z.enum(['active', 'suspended', 'blocked']),
    reason: z.string().trim().max(SELLER_SUSPEND_REASON_MAX).nullable().optional(),
  })
  .strict();
export type InternalAccountStatusRequest = z.output<typeof internalAccountStatusRequestSchema>;
