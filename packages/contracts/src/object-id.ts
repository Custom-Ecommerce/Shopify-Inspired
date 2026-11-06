import { z } from 'zod';

/** A MongoDB ObjectId in its 24-character hex string form. */
export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a 24-character ObjectId');
