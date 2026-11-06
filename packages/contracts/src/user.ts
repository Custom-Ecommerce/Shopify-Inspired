import { z } from 'zod';
import { objectIdSchema } from './object-id';

export const USER_ROLES = ['admin', 'seller'] as const;

/**
 * The public User. The model's passwordHash, loginAttempts and lockUntil never leave the server,
 * so this schema omits them. Zod strips unknown keys, so a parsed user cannot carry them.
 */
export const userSchema = z.object({
  id: objectIdSchema,
  name: z.string().min(1),
  email: z.string().min(3),
  role: z.enum(USER_ROLES),
  store: objectIdSchema.nullable().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type User = z.infer<typeof userSchema>;
