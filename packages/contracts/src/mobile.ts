import { z } from 'zod';
import { objectIdSchema } from './object-id';
import { USER_ROLES } from './user';

/*
 * Sprint 9 (EP-31, D-120, D-123): the wire shapes of the phone apps. /api/mobile/v1 (seller backend) and /api/admin/mobile/v1 (admin backend) are FROZEN
 * contracts: a new optional answer field is fine, anything that breaks an installed app needs a v2. This file stays free of Node imports: the apps use it.
 */

export const MOBILE_APPS = ['seller', 'admin'] as const;
/** Every request of an app carries these two; a missing or old version is 426 UPGRADE_REQUIRED once a minimum is set. */
export const MOBILE_APP_VERSION_HEADER = 'x-app-version';
export const MOBILE_APP_PLATFORM_HEADER = 'x-app-platform';
export const MOBILE_PLATFORMS = ['android'] as const;
export const MOBILE_DEVICE_NAME_MAX = 80;
export const MOBILE_APP_VERSION_MAX = 32;

const emailSchema = z.string({ error: 'email is required' }).trim().toLowerCase().max(254).email('enter a valid email address');
const passwordFieldSchema = z.string({ error: 'password is required' }).min(1, 'password is required').max(200);
const deviceNameSchema = z.string({ error: 'deviceName is required' }).trim().min(1, 'deviceName is required').max(MOBILE_DEVICE_NAME_MAX);
const appVersionSchema = z.string({ error: 'appVersion is required' }).trim().regex(/^\d{1,5}(\.\d{1,5}){0,3}([-+][0-9A-Za-z.-]{1,12})?$/, 'appVersion must look like 1.2.3').max(MOBILE_APP_VERSION_MAX);
const installationIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'installationId must be 8 to 64 letters, digits, - or _');
const refreshTokenSchema = z.string({ error: 'refreshToken is required' }).min(1, 'refreshToken is required').max(400);

/** The fields every sign-in names the phone with. */
export const mobileDeviceFields = {
  deviceName: deviceNameSchema,
  platform: z.enum(MOBILE_PLATFORMS),
  appVersion: appVersionSchema,
  installationId: installationIdSchema.optional(),
};

export const mobileLoginRequestSchema = z.object({ email: emailSchema, password: passwordFieldSchema, ...mobileDeviceFields }).strict();
/** The admin sign-in adds the second factor: a 6 digit authenticator code, or one recovery code. */
export const mobileAdminLoginRequestSchema = z
  .object({
    email: emailSchema,
    password: passwordFieldSchema,
    ...mobileDeviceFields,
    totp: z.string().trim().regex(/^\d{6}$/, 'totp is the 6 digit code').optional(),
    recoveryCode: z.string().trim().min(8, 'recoveryCode is too short').max(40).optional(),
  })
  .strict();

/** The codes of the admin second factor. */
export const MOBILE_TOTP_CODES = {
  /** 403 with { enrolment: { secret, otpauthUri } }: add the secret to an authenticator app, then sign in again with its code. */
  ENROLMENT_REQUIRED: 'TOTP_ENROLMENT_REQUIRED',
  /** 403: the account has a second factor; send totp or recoveryCode. */
  REQUIRED: 'TOTP_REQUIRED',
  /** 401: the code is wrong, expired or already used. */
  INVALID: 'TOTP_INVALID',
  /** 401: the recovery code is wrong or already used. */
  RECOVERY_INVALID: 'RECOVERY_CODE_INVALID',
  /** 409: the stored secret cannot be read any more; an owner must reset the second factor. */
  RESET_REQUIRED: 'TOTP_RESET_REQUIRED',
} as const;

export const mobileRefreshRequestSchema = z.object({ refreshToken: refreshTokenSchema, appVersion: appVersionSchema.optional() }).strict();
export const mobileLogoutRequestSchema = z.object({ refreshToken: refreshTokenSchema }).strict();

export const mobileTokensSchema = z.object({
  accessToken: z.string().min(1),
  /** Seconds. */
  accessTokenExpiresIn: z.number().int().positive(),
  refreshToken: z.string().min(1),
  refreshTokenExpiresAt: z.string().datetime(),
});

export const mobileUserSchema = z.object({
  id: objectIdSchema,
  name: z.string(),
  email: z.string(),
  role: z.enum(USER_ROLES),
  store: objectIdSchema.nullable(),
  emailVerified: z.boolean(),
});

export const mobileSessionResponseSchema = mobileTokensSchema.extend({ deviceId: z.string().min(1), user: mobileUserSchema });

export const mobileAdminUserSchema = z.object({ id: objectIdSchema, name: z.string(), email: z.string() });
export const mobileAdminSessionResponseSchema = mobileTokensSchema.extend({
  deviceId: z.string().min(1),
  user: mobileAdminUserSchema,
  adminLevel: z.enum(['owner', 'finance', 'operations', 'customer_support']),
  capabilities: z.array(z.string()),
  /** Present once, right after the enrolment: show them and never again. */
  recoveryCodes: z.array(z.string()).optional(),
});
export const mobileTotpEnrolmentSchema = z.object({ secret: z.string().min(16), otpauthUri: z.string().startsWith('otpauth://totp/') });

export const mobileDeviceSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  platform: z.enum(MOBILE_PLATFORMS),
  appVersion: z.string(),
  lastSeenAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  /** The device this request came from. Always false for a request from the web. */
  current: z.boolean(),
});
export const mobileDeviceListResponseSchema = z.object({ devices: z.array(mobileDeviceSchema) });
export const mobileDeviceRevokeResponseSchema = z.object({ id: z.string().min(1), revoked: z.literal(true), changed: z.boolean() });

export type MobileLoginRequest = z.infer<typeof mobileLoginRequestSchema>;
export type MobileRefreshRequest = z.infer<typeof mobileRefreshRequestSchema>;
export type MobileLogoutRequest = z.infer<typeof mobileLogoutRequestSchema>;
export type MobileTokensWire = z.infer<typeof mobileTokensSchema>;
export type MobileUser = z.infer<typeof mobileUserSchema>;
export type MobileAdminLoginRequest = z.infer<typeof mobileAdminLoginRequestSchema>;
export type MobileAdminSessionResponse = z.infer<typeof mobileAdminSessionResponseSchema>;
export type MobileTotpEnrolment = z.infer<typeof mobileTotpEnrolmentSchema>;
export type MobileSessionResponse = z.infer<typeof mobileSessionResponseSchema>;
export type MobileDevice = z.infer<typeof mobileDeviceSchema>;
export type MobileDeviceListResponse = z.infer<typeof mobileDeviceListResponseSchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Push (S9-B3)

export const MOBILE_SELLER_PUSH_KINDS = ['order_new', 'order_cancelled', 'low_stock', 'subscription_payment', 'support_reply'] as const;
export const MOBILE_ADMIN_PUSH_KINDS = ['payment_claim', 'ticket_new', 'sync_failure'] as const;

/** POST /devices/push-token: the Expo push token of THIS phone, or null to stop pushes to it. */
export const mobilePushTokenRequestSchema = z
  .object({ token: z.string().max(254).regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_\-:.]{10,200}\]$/, 'token is not an Expo push token').nullable() })
  .strict();
export const mobilePushTokenResponseSchema = z.object({ ok: z.literal(true), registered: z.boolean() });

/** Quiet hours in Pakistan time (UTC+5, no daylight saving): a push that falls inside them is not sent. The alert is still in the app. */
const clockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use the 24 hour format HH:MM');
export const mobileQuietHoursSchema = z
  .object({ start: clockSchema, end: clockSchema })
  .strict()
  .refine((hours) => hours.start !== hours.end, { message: 'Start and end must differ.' });
export type MobileQuietHours = z.infer<typeof mobileQuietHoursSchema>;

const pushKindSchema = z.enum([...MOBILE_SELLER_PUSH_KINDS, ...MOBILE_ADMIN_PUSH_KINDS]);
export const mobilePushSettingsSchema = z.object({ muted: z.boolean(), mutedKinds: z.array(z.string()), kinds: z.array(z.string()), quietHours: mobileQuietHoursSchema.nullable().optional() });
export const mobilePushSettingsUpdateSchema = z
  .object({ muted: z.boolean().optional(), mutedKinds: z.array(pushKindSchema).max(20).optional(), quietHours: mobileQuietHoursSchema.nullable().optional() })
  .strict()
  .refine((body) => body.muted !== undefined || body.mutedKinds !== undefined || body.quietHours !== undefined, { message: 'Change muted, mutedKinds or quietHours.' });

export type MobilePushSettings = z.infer<typeof mobilePushSettingsSchema>;
