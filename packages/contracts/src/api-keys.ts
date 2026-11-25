import { z } from 'zod';
import { objectIdSchema } from './object-id';

/*
 * Sprint 8 (S8-B4, D-118): the API keys of a store (read-only v1 API). Owner only (capability api_keys.manage). Every body is strict. The secret of a key is
 * in ONE answer only (the create answer); no other answer has a field for it, or for its hash.
 */

export const API_KEY_SCOPES = ['products:read', 'orders:read'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
export const API_KEY_NAME_MAX = 40;

export const API_KEY_ERROR_CODES = {
  API_KEY_NOT_FOUND: 'API_KEY_NOT_FOUND',
} as const;

const NO_HTML = /[<>]/;

const name = z
  .string({ error: 'give the key a name' })
  .transform((value) => value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(1, 'give the key a name')
      .max(API_KEY_NAME_MAX, 'the name can be at most ' + API_KEY_NAME_MAX + ' characters')
      .refine((value) => !NO_HTML.test(value), 'the name cannot contain < or >'),
  );

const scopes = z
  .array(z.enum(API_KEY_SCOPES, { error: 'the scopes are products:read and orders:read' }), { error: 'choose at least one scope' })
  .min(1, 'choose at least one scope')
  .max(API_KEY_SCOPES.length, 'choose each scope once')
  .refine((value) => new Set(value).size === value.length, 'choose each scope once');

/** POST /api/stores/:id/api-keys */
export const apiKeyCreateRequestSchema = z.object({ name, scopes }).strict();

/** One key as the owner reads it. Strict: a hash or a secret added by mistake fails the parse instead of being answered. */
export const apiKeySchema = z
  .object({
    id: objectIdSchema,
    name: z.string(),
    /** The public part of the key, "mkz_live_<prefix>": enough to tell keys apart, useless to call the API. */
    prefix: z.string(),
    scopes: z.array(z.enum(API_KEY_SCOPES)),
    lastUsedAt: z.string().nullable(),
    createdAt: z.string(),
    revokedAt: z.string().nullable(),
  })
  .strict();
export type ApiKeyView = z.output<typeof apiKeySchema>;

export const apiKeyListResponseSchema = z
  .object({
    keys: z.array(apiKeySchema),
    /** Live (not revoked) keys against the plan; limit null is unlimited. */
    usage: z.object({ used: z.number().int().min(0), limit: z.number().int().min(0).nullable() }),
  })
  .strict();
export type ApiKeyListResponse = z.output<typeof apiKeyListResponseSchema>;

/** The ONE answer that carries the secret: the full key, shown once. */
export const apiKeyCreateResponseSchema = z.object({ key: apiKeySchema, secret: z.string() }).strict();
export type ApiKeyCreateResponse = z.output<typeof apiKeyCreateResponseSchema>;

export const apiKeyResponseSchema = z.object({ key: apiKeySchema }).strict();
export type ApiKeyResponse = z.output<typeof apiKeyResponseSchema>;

export type ApiKeyCreateRequest = z.output<typeof apiKeyCreateRequestSchema>;
