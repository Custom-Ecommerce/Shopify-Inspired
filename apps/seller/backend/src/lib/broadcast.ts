import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PipelineStage } from 'mongoose';
import type {
  BroadcastCounts,
  BroadcastList,
  BroadcastListQuery,
  BroadcastPreview,
  BroadcastRow,
  CreateBroadcastRequest,
  CustomerList,
  CustomerListQuery,
} from '@markaz/contracts';
import type { AuthContext } from '@/lib/auth';
import { sellerPortalLink } from '@/lib/account-support';
import { ACCOUNT_CODES, BROADCAST_CODES, BROADCAST_RECIPIENT_CAP, karachiDayLabel } from '@/lib/contracts';
import { HttpError, isDuplicateKeyError } from '@/lib/http';
import { oid } from '@/lib/ledger-aggregates';
import { enqueueEmail } from '@/lib/notifications';
import { Broadcast, EmailUnsubscribe, NotificationOutbox, Order, writeAuditLog } from '@/lib/services';

/**
 * Sprint 4 EP-07.US04 (D-092): the store's customers, the broadcast to them, and the unsubscribe link.
 *
 * Customers: there is no customer collection. A customer is derived from the store's orders (customerName, customerEmail,
 * phone, customerWhatsapp), grouped by the lower-case email, or by the phone when the order has no email. A shopper who
 * ordered once with an email and once without therefore appears twice; that is the only source there is.
 *
 * Every read here is scoped by the store id the route already proved belongs to the signed-in seller.
 */

// ------------------------------------------------------------------------------------------------------ the signed link

export const UNSUBSCRIBE_MIN_SECRET_LENGTH = 16;

/** The signing secret, or null when it is missing or shorter than 16 characters (then nothing is signed or accepted). */
export function unsubscribeSecret(): string | null {
  const raw = process.env.UNSUBSCRIBE_SIGNING_SECRET;
  return typeof raw === 'string' && raw.length >= UNSUBSCRIBE_MIN_SECRET_LENGTH ? raw : null;
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** HMAC-SHA256 (hex) over the store id and the lower-case email. */
export function signUnsubscribe(storeId: string, email: string, secret: string): string {
  return createHmac('sha256', secret).update('unsubscribe\n' + storeId.toLowerCase() + '\n' + normalizeEmail(email)).digest('hex');
}

/** Constant-time check of a signature. A wrong length or a non-hex value is simply false. */
export function verifyUnsubscribe(storeId: string, email: string, signature: string, secret: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = Buffer.from(signUnsubscribe(storeId, email, secret), 'hex');
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The link in a broadcast: the seller portal's public /unsubscribe page. Null when APP_BASE_URL_SELLER is not usable. */
export function unsubscribeLink(storeId: string, email: string, secret: string): string | null {
  return sellerPortalLink('/unsubscribe?s=' + storeId + '&e=' + encodeURIComponent(normalizeEmail(email)) + '&t=' + signUnsubscribe(storeId, email, secret));
}

/** 503 BROADCAST_NOT_CONFIGURED unless a broadcast could carry a signed unsubscribe link. */
export function requireBroadcastConfig(): string {
  const secret = unsubscribeSecret();
  if (secret === null || sellerPortalLink('/unsubscribe') === null) {
    throw new HttpError(503, 'Broadcasts are not available yet: the platform has not been set up for unsubscribe links.', BROADCAST_CODES.NOT_CONFIGURED);
  }
  return secret;
}

// ------------------------------------------------------------------------------------------------------------ customers

type Row = Record<string, unknown>;

interface CustomerGroup {
  _id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  orders: number;
  lastOrderAt?: Date | string | null;
}

/** The stages that turn a store's orders into customer groups, newest order first. */
function customerGroupStages(storeId: string): Row[] {
  return [
    { $match: { store: oid(storeId) } },
    { $addFields: { _email: { $toLower: { $trim: { input: { $ifNull: ['$customerEmail', ''] } } } }, _phone: { $ifNull: ['$phone', ''] } } },
    { $addFields: { _key: { $cond: [{ $ne: ['$_email', ''] }, '$_email', '$_phone'] } } },
    { $match: { _key: { $ne: '' } } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$_key',
        name: { $first: '$customerName' },
        email: { $first: '$_email' },
        phone: { $first: '$_phone' },
        whatsapp: { $first: '$customerWhatsapp' },
        orders: { $sum: 1 },
        lastOrderAt: { $max: '$createdAt' },
      },
    },
  ];
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const iso = (value: unknown): string | null => (value ? new Date(value as Date | string).toISOString() : null);

async function unsubscribedAmong(storeId: string, emails: readonly string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const rows = (await EmailUnsubscribe.find({ store: oid(storeId), email: { $in: [...emails] } })
    .select('email')
    .lean()) as unknown as Array<{ email?: string }>;
  return new Set(rows.map((row) => String(row.email ?? '').toLowerCase()));
}

/** One page of the store's customers, most recent buyer first. `phone: '1'` keeps only customers with a phone number. */
export async function listCustomers(storeId: string, query: CustomerListQuery): Promise<CustomerList> {
  const phoneOnly: Row[] = query.phone === '1' ? [{ $match: { phone: { $nin: ['', null] } } }] : [];
  const pipeline = [
    ...customerGroupStages(storeId),
    ...phoneOnly,
    { $sort: { lastOrderAt: -1, _id: 1 } },
    { $facet: { rows: [{ $skip: (query.page - 1) * query.limit }, { $limit: query.limit }], total: [{ $count: 'n' }] } },
  ];
  const facets = (await Order.aggregate(pipeline as unknown as PipelineStage[])) as unknown as Array<{ rows?: CustomerGroup[]; total?: Array<{ n?: number }> }>;
  const rows = facets[0]?.rows ?? [];
  const totalDocs = facets[0]?.total?.[0]?.n ?? 0;
  const unsubscribed = await unsubscribedAmong(storeId, rows.map((row) => text(row.email)).filter((email): email is string => email !== null));
  return {
    docs: rows.map((row) => {
      const email = text(row.email);
      return {
        id: String(row._id),
        name: text(row.name),
        email,
        phone: text(row.phone),
        whatsapp: text(row.whatsapp),
        orderCount: Number(row.orders ?? 0),
        lastOrderAt: iso(row.lastOrderAt),
        unsubscribed: email !== null && unsubscribed.has(email),
      };
    }),
    page: query.page,
    limit: query.limit,
    totalDocs,
    totalPages: Math.ceil(totalDocs / query.limit),
  };
}

// ----------------------------------------------------------------------------------------------------------- recipients

const EMAIL_SHAPE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;
/** dedupeKey is broadcast:<24 hex>:<email> and the outbox allows 200 characters, so a longer address cannot be a recipient. */
export const BROADCAST_EMAIL_MAX = 160;
/** How many distinct customer emails one recipient search reads at most. */
const RECIPIENT_SCAN_MAX = 5000;

/**
 * The customers with an email who have not unsubscribed, most recent buyers first, at most the cap PLUS ONE (so a caller can
 * tell "exactly the cap" from "too many" without reading the rest).
 */
export async function eligibleRecipients(storeId: string): Promise<string[]> {
  const pipeline = [
    ...customerGroupStages(storeId),
    { $match: { email: { $nin: ['', null] } } },
    { $sort: { lastOrderAt: -1, _id: 1 } },
    { $limit: RECIPIENT_SCAN_MAX },
  ];
  const groups = (await Order.aggregate(pipeline as unknown as PipelineStage[])) as unknown as CustomerGroup[];
  const candidates = [
    ...new Set(
      groups
        .map((group) => normalizeEmail(String(group.email ?? '')))
        .filter((email) => email !== '' && email.length <= BROADCAST_EMAIL_MAX && EMAIL_SHAPE.test(email)),
    ),
  ];
  const unsubscribed = await unsubscribedAmong(storeId, candidates);
  return candidates.filter((email) => !unsubscribed.has(email)).slice(0, BROADCAST_RECIPIENT_CAP + 1);
}

export async function previewBroadcast(storeId: string): Promise<BroadcastPreview> {
  const recipients = await eligibleRecipients(storeId);
  return { recipientCount: Math.min(recipients.length, BROADCAST_RECIPIENT_CAP), cap: BROADCAST_RECIPIENT_CAP, tooLarge: recipients.length > BROADCAST_RECIPIENT_CAP };
}

// ------------------------------------------------------------------------------------------------------------ broadcasts

interface BroadcastDoc {
  _id: unknown;
  subject: string;
  message: string;
  recipientCount: number;
  createdAt: Date | string;
}

/** queued / sent / failed / skipped, counted from the outbox rows of ONE broadcast (anchored dedupeKey prefix). */
export async function broadcastCounts(broadcastId: string): Promise<BroadcastCounts> {
  const counts: BroadcastCounts = { queued: 0, sent: 0, failed: 0, skipped: 0 };
  if (!/^[0-9a-fA-F]{24}$/.test(broadcastId)) return counts;
  const rows = (await NotificationOutbox.find({ dedupeKey: { $regex: '^broadcast:' + broadcastId + ':' } })
    .select('status')
    .lean()) as unknown as Array<{ status?: string }>;
  for (const row of rows) {
    if (row.status === 'queued' || row.status === 'sent' || row.status === 'failed' || row.status === 'skipped') counts[row.status] += 1;
  }
  return counts;
}

async function toRow(doc: BroadcastDoc): Promise<BroadcastRow> {
  return {
    id: String(doc._id),
    subject: doc.subject,
    message: doc.message,
    recipientCount: doc.recipientCount,
    createdAt: iso(doc.createdAt) ?? '',
    counts: await broadcastCounts(String(doc._id)),
  };
}

export async function listBroadcasts(storeId: string, query: BroadcastListQuery): Promise<BroadcastList> {
  const filter = { store: oid(storeId) };
  const [docs, totalDocs] = await Promise.all([
    Broadcast.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean() as unknown as Promise<BroadcastDoc[]>,
    Broadcast.countDocuments(filter),
  ]);
  return { docs: await Promise.all(docs.map(toRow)), page: query.page, limit: query.limit, totalDocs, totalPages: Math.ceil(totalDocs / query.limit) };
}

const QUEUE_CHUNK = 25;

export interface BroadcastStore {
  id: string;
  name: string;
  /** The store's own email footer, or null (the store name is used). */
  footer: string | null;
}

/**
 * Makes a broadcast. In this order: the recipients now (more than the cap is 422, nobody is 422), the count the seller
 * confirmed (409 if it differs), then ONE insert that the unique index { store, dayKey } allows once a day (a second is 429),
 * and only then the outbox rows, so the loser of two parallel calls queues nothing. The rows are written with sendNow false:
 * the flush route sends them in batches.
 */
export async function createBroadcast(ctx: AuthContext, store: BroadcastStore, input: CreateBroadcastRequest, now: Date = new Date()): Promise<BroadcastRow> {
  const secret = requireBroadcastConfig();
  const recipients = await eligibleRecipients(store.id);
  if (recipients.length > BROADCAST_RECIPIENT_CAP) {
    throw new HttpError(422, 'A broadcast can go to at most ' + BROADCAST_RECIPIENT_CAP + ' customers.', BROADCAST_CODES.TOO_LARGE);
  }
  if (recipients.length === 0) throw new HttpError(422, 'No customer with an email address can receive this broadcast.', BROADCAST_CODES.NO_RECIPIENTS);
  if (input.expectedCount !== recipients.length) {
    throw new HttpError(409, 'The number of recipients changed to ' + recipients.length + '. Check the preview and confirm again.', BROADCAST_CODES.COUNT_CHANGED);
  }

  let created: BroadcastDoc;
  try {
    created = (await Broadcast.create({
      store: oid(store.id),
      subject: input.subject,
      message: input.message,
      recipientCount: recipients.length,
      createdBy: ctx.userObjectId,
      dayKey: karachiDayLabel(now),
      status: 'queued',
    })) as unknown as BroadcastDoc;
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new HttpError(429, 'Your store already sent a broadcast today. You can send one broadcast a day.', BROADCAST_CODES.DAILY_LIMIT);
    }
    throw err;
  }

  const id = String(created._id);
  let queueErrors = 0;
  for (let at = 0; at < recipients.length; at += QUEUE_CHUNK) {
    const outcomes = await Promise.all(
      recipients.slice(at, at + QUEUE_CHUNK).map(async (email) => {
        const link = unsubscribeLink(store.id, email, secret);
        if (link === null) return { outcome: 'error' } as const;
        return enqueueEmail(
          {
            template: 'broadcast',
            to: email,
            vars: { storeName: store.name, broadcastSubject: input.subject, broadcastMessage: input.message, emailFooter: store.footer ?? store.name, unsubscribeLink: link },
            store: store.id,
            dedupeKey: 'broadcast:' + id + ':' + email,
          },
          { sendNow: false },
        );
      }),
    );
    queueErrors += outcomes.filter((result) => result.outcome === 'error' || result.outcome === 'no_recipient').length;
  }

  try {
    // The count only: never an email address, never the message.
    await writeAuditLog('broadcast.create', 'broadcast', id, 'seller:' + ctx.userId, { storeId: store.id, recipientCount: recipients.length, queueErrors, at: now.toISOString() });
  } catch (err) {
    console.error('[seller-backend] could not write the broadcast audit entry', err instanceof Error ? err.name : 'unknown');
  }
  return toRow(created);
}

// ----------------------------------------------------------------------------------------------------------- unsubscribe

/**
 * Records that this customer no longer wants this store's broadcasts. Idempotent: a second call, or a lost race on the unique
 * index, changes nothing. The caller has checked the signature.
 */
export async function recordUnsubscribe(storeId: string, email: string, now: Date = new Date()): Promise<void> {
  const address = normalizeEmail(email);
  try {
    await EmailUnsubscribe.updateOne({ store: oid(storeId), email: address }, { $setOnInsert: { store: oid(storeId), email: address, at: now } }, { upsert: true });
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
  }
}

// ------------------------------------------------------------------------------------------------------- query parsing

interface QuerySchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string; code?: string; keys?: unknown[] }> } };
}

/** 400 with the field, like the other seller routes. */
export function readQuery<T>(request: { nextUrl: { searchParams: URLSearchParams } }, schema: QuerySchema<T>): T {
  const parsed = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const unknownKey = issue?.code === 'unrecognized_keys' && Array.isArray(issue.keys) ? issue.keys[0] : undefined;
  const field = unknownKey !== undefined ? String(unknownKey) : issue && issue.path.length > 0 ? issue.path.map(String).join('.') : 'query';
  throw new HttpError(400, issue?.message ?? 'Invalid request', ACCOUNT_CODES.BODY_INVALID, field);
}
