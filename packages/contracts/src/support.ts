import { z } from 'zod';
import { objectIdSchema } from './object-id';

/**
 * Sprint 7 (S7-B4): the contact messages (a shopper to a store, a visitor to the platform) and the support tickets (a seller to the platform). All strict:
 * a field that is not listed is refused. Text is plain text; it is escaped wherever it is shown, never parsed.
 */

export const CONTACT_NAME_MAX = 100;
export const CONTACT_EMAIL_MAX = 200;
export const CONTACT_PHONE_MAX = 30;
export const CONTACT_MESSAGE_MAX = 3000;
export const CONTACT_MESSAGE_MIN = 5;
export const TICKET_SUBJECT_MAX = 150;
export const TICKET_TEXT_MAX = 3000;
export const SUPPORT_LIST_MAX = 50;

export const CONTACT_STATUSES = ['new', 'read', 'replied', 'closed'] as const;
export const CONTACT_SCOPES = ['platform', 'store'] as const;
export const TICKET_STATUSES = ['open', 'answered', 'closed'] as const;

export const CONTACT_INVALID = 'CONTACT_INVALID';
export const CONTACT_REVISION_CONFLICT = 'CONTACT_REVISION_CONFLICT';
export const TICKET_INVALID = 'TICKET_INVALID';
export const TICKET_REVISION_CONFLICT = 'TICKET_REVISION_CONFLICT';
export const TICKET_CLOSED = 'TICKET_CLOSED';

const name = z.string('Enter your name.').trim().min(1, 'Enter your name.').max(CONTACT_NAME_MAX, 'The name can be at most 100 characters.');
const emailText = z.string().trim().max(CONTACT_EMAIL_MAX, 'The email can be at most 200 characters.');
const email = emailText.pipe(z.string().email('Enter a valid email address.'));
const phone = z
  .string()
  .trim()
  .max(CONTACT_PHONE_MAX, 'The phone number can be at most 30 characters.')
  .regex(/^[+0-9 ()-]{7,30}$/, 'Enter a valid phone number.');
const message = z
  .string('Write a message.')
  .trim()
  .min(CONTACT_MESSAGE_MIN, 'Write a message of at least 5 characters.')
  .max(CONTACT_MESSAGE_MAX, 'The message can be at most 3000 characters.');

/**
 * POST a store's contact form. `website` is the HONEYPOT: a field no person sees or fills. A filled one is a bot: the route answers success and stores
 * nothing. Either an email or a phone is needed, so the seller can answer.
 */
export const storeContactRequestSchema = z
  .object({
    name,
    email: z.union([z.literal(''), email]).optional(),
    phone: z.union([z.literal(''), phone]).optional(),
    message,
    consent: z.literal(true, 'Please agree to be contacted.'),
    website: z.string().max(500).optional(),
  })
  .strict()
  .refine((body) => (body.email ?? '') !== '' || (body.phone ?? '') !== '', { message: 'Give an email or a phone number so the store can answer.', path: ['email'] });

/** POST the platform's contact form: an email is required (the answer goes there). */
export const platformContactRequestSchema = z
  .object({ name, email, message, consent: z.literal(true, 'Please agree to be contacted.'), website: z.string().max(500).optional() })
  .strict();

export const contactListQuerySchema = z
  .object({
    status: z.enum(CONTACT_STATUSES).optional(),
    page: z.coerce.number().int().min(1).max(10000).optional(),
    limit: z.coerce.number().int().min(1).max(SUPPORT_LIST_MAX).optional(),
  })
  .strict();

const revision = z.number('Reload the message: its version is missing.').int('Reload the message: its version is missing.').min(0);

/** PATCH a message: mark read, or close. (replied is only ever set by a reply.) */
export const contactStatusUpdateSchema = z.object({ revision, status: z.enum(['read', 'closed'], 'Choose read or closed.') }).strict();
export const contactReplySchema = z.object({ revision, text: z.string('Write a reply.').trim().min(1, 'Write a reply.').max(TICKET_TEXT_MAX, 'The reply can be at most 3000 characters.') }).strict();

// ------------------------------------------------------------------------------------------------------------------------------ tickets

export const ticketCreateSchema = z
  .object({
    subject: z.string('Enter a subject.').trim().min(3, 'The subject needs at least 3 characters.').max(TICKET_SUBJECT_MAX, 'The subject can be at most 150 characters.'),
    message: z.string('Describe the problem.').trim().min(5, 'Describe the problem in at least 5 characters.').max(TICKET_TEXT_MAX, 'The message can be at most 3000 characters.'),
    store: objectIdSchema.optional(),
    orderRef: z.string().trim().max(40, 'The order number can be at most 40 characters.').optional(),
  })
  .strict();

const ticketRevision = z.number('Reload the ticket: its version is missing.').int('Reload the ticket: its version is missing.').min(0);
const ticketText = z.string('Write a message.').trim().min(1, 'Write a message.').max(TICKET_TEXT_MAX, 'The message can be at most 3000 characters.');
export const ticketReplySchema = z.object({ revision: ticketRevision, text: ticketText }).strict();
export const ticketCloseSchema = z.object({ revision: ticketRevision }).strict();
/** An admin moves a ticket between open, answered and closed. */
export const ticketStatusUpdateSchema = z.object({ revision: ticketRevision, status: z.enum(TICKET_STATUSES, 'Choose open, answered or closed.') }).strict();
export const ticketListQuerySchema = z
  .object({ status: z.enum(TICKET_STATUSES).optional(), page: z.coerce.number().int().min(1).max(10000).optional(), limit: z.coerce.number().int().min(1).max(SUPPORT_LIST_MAX).optional() })
  .strict();

/** The internal (admin to seller backend) calls carry the ticket or message id in the body. */
export const internalSupportIdSchema = z.object({ id: objectIdSchema }).strict();
export const internalTicketReplySchema = z.object({ id: objectIdSchema, revision: ticketRevision, text: ticketText }).strict();
export const internalTicketStatusSchema = z.object({ id: objectIdSchema, revision: ticketRevision, status: z.enum(TICKET_STATUSES) }).strict();
export const internalSupportListSchema = z
  .object({ status: z.string().max(20).optional(), page: z.number().int().min(1).max(10000).optional(), limit: z.number().int().min(1).max(SUPPORT_LIST_MAX).optional() })
  .strict();

export type StoreContactRequest = z.infer<typeof storeContactRequestSchema>;
export type PlatformContactRequest = z.infer<typeof platformContactRequestSchema>;
export type TicketCreate = z.infer<typeof ticketCreateSchema>;
