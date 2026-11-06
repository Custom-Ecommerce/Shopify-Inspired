import { z } from 'zod';
import { objectIdSchema } from './object-id';
import { USER_ROLES } from './user';

/** The session user as /api/users/me and the login and signup responses return it (id, not _id). */
export const sessionUserSchema = z.object({
  id: objectIdSchema,
  name: z.string().min(1),
  email: z.string().min(3),
  role: z.enum(USER_ROLES),
  store: objectIdSchema.nullable(),
});

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const signupRequestSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8, 'password must be at least 8 characters'),
});

export const authResponseSchema = z.object({
  token: z.string().min(1),
  user: sessionUserSchema,
});

export const signupResponseSchema = z.object({
  success: z.literal(true),
  token: z.string().min(1),
  user: sessionUserSchema,
});

export type SessionUser = z.infer<typeof sessionUserSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type SignupRequest = z.infer<typeof signupRequestSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
export type SignupResponse = z.infer<typeof signupResponseSchema>;
