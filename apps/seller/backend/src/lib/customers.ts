import type { PipelineStage } from 'mongoose';
import type {
  CustomerAddress,
  CustomerAddressBook,
  CustomerAddressEntry,
  CustomerDetail,
  CustomerExportQuery,
  CustomerList,
  CustomerListQuery,
  CustomerNoteRequest,
  CustomerNoteResult,
  CustomerOrderRow,
  CustomerRow,
  CustomerSort,
  CustomerStats,
} from '@markaz/contracts';
import type { AuthContext } from '@/lib/auth';
import {
  ACCOUNT_CODES,
  ADDRESS_BOOK_MAX,
  ADDRESS_BOOK_SCAN_MAX,
  CUSTOMER_CSV_COLUMNS,
  CUSTOMER_DETAIL_ADDRESSES_MAX,
  CUSTOMER_DETAIL_ORDERS_MAX,
  CUSTOMER_EXPORT_MAX_ROWS,
  normalizeCustomerKey,
} from '@/lib/contracts';
import { HttpError, isDuplicateKeyError } from '@/lib/http';
import { oid } from '@/lib/ledger-aggregates';
import { serializeCsv } from '@/lib/product-csv';
import { returnsCountFor } from '@/lib/returns';
import { CustomerNote, EmailUnsubscribe, Order } from '@/lib/services';

/**
 * Sprint 5 EP-10.US01 / US02 (D-107, D-108): the seller's customers. There is NO customer collection: a customer is derived
 * from ONE store's orders and grouped by the normalized phone (Order.phoneKey, +923xxxxxxxxx) first. Only an order with no
 * phoneKey (no phone, or a phone that is not a Pakistani mobile number) is grouped by its lower-case email, so a shopper who
 * ordered once with an email and once without is ONE customer. An order with neither is not a customer at all (A-028).
 * The only stored extra is the seller's CustomerNote (note and tags).
 *
 * This module replaces customerGroupStages of lib/broadcast.ts (Sprint 4). The broadcast reads its recipient emails through
 * customerEmails below, so the counts do not change for email-only data.
 *
 * Every read here is scoped by the store id the route already proved belongs to the signed-in seller, in the FIRST $match.
 * The phone rule is normalizePhoneE164 (contracts); it is applied when an order is created and by the backfill script, never here.
 */

type Row = Record<string, unknown>;

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();
export const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
export const iso = (value: unknown): string | null => (value ? new Date(value as Date | string).toISOString() : null);
const whole = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0);

/** How many unsubscribed emails the "unsubscribed" filter reads at most. */
const UNSUBSCRIBED_SCAN_MAX = 5000;
/** How many distinct customer emails one recipient search reads at most. */
export const RECIPIENT_SCAN_MAX = 5000;

// ------------------------------------------------------------------------------------------------------------------ keys

/**
 * The stages that give every order of the store its customer key (_key): the phoneKey, else the lower-case email, else '' (then
 * the order is not part of any customer). With `key` the stages keep only that customer's orders; a phone key also starts from
 * the { store, phoneKey } index.
 */
export function keyedOrderStages(storeId: string, key?: string): Row[] {
  const first: Row = { store: oid(storeId) };
  if (key !== undefined && key.startsWith('+')) first.phoneKey = key;
  return [
    { $match: first },
    {
      $addFields: {
        _email: { $toLower: { $trim: { input: { $ifNull: ['$customerEmail', ''] } } } },
        _phoneKey: { $ifNull: ['$phoneKey', ''] },
      },
    },
    { $addFields: { _key: { $cond: [{ $ne: ['$_phoneKey', ''] }, '$_phoneKey', '$_email'] } } },
    { $match: { _key: key ?? { $ne: '' } } },
  ];
}

/** ISO text with a fixed length of 24, so the newest email of a group is the largest string. */
const STAMP_FORMAT = '%Y-%m-%dT%H:%M:%S.%LZ';
const STAMP_LENGTH = 24;

/** Orders into customer groups with their statistics, in one pass. The newest order supplies the name and WhatsApp number. */
const GROUP_STAGES: Row[] = [
  { $sort: { createdAt: -1 } },
  {
    $group: {
      _id: '$_key',
      name: { $first: '$customerName' },
      whatsapp: { $first: '$customerWhatsapp' },
      phone: { $max: '$_phoneKey' },
      // The newest non-empty email: "<24 character ISO time>|<email>", the largest such string.
      emailStamp: {
        $max: {
          $cond: [{ $ne: ['$_email', ''] }, { $concat: [{ $dateToString: { format: STAMP_FORMAT, date: '$createdAt' } }, '|', '$_email'] }, ''],
        },
      },
      orders: { $sum: 1 },
      deliveredCount: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
      cancelledCount: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
      // Delivered orders only, the item subtotal after the discount (delivery is not what the shopper bought).
      totalSpent: {
        $sum: {
          $cond: [{ $eq: ['$status', 'delivered'] }, { $max: [0, { $subtract: [{ $ifNull: ['$subtotal', 0] }, { $ifNull: ['$discountAmount', 0] }] }] }, 0],
        },
      },
      firstOrderAt: { $min: '$createdAt' },
      lastOrderAt: { $max: '$createdAt' },
    },
  },
  { $addFields: { email: { $cond: [{ $eq: [{ $ifNull: ['$emailStamp', ''] }, ''] }, '', { $substrCP: ['$emailStamp', STAMP_LENGTH + 1, 1000] }] } } },
];

/** The customer groups of a store, or of ONE customer when `key` is given. */
export function customerStages(storeId: string, key?: string): Row[] {
  return [...keyedOrderStages(storeId, key), ...GROUP_STAGES];
}

export interface CustomerGroup {
  _id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  orders: number;
  deliveredCount?: number;
  cancelledCount?: number;
  totalSpent?: number;
  firstOrderAt?: Date | string | null;
  lastOrderAt?: Date | string | null;
}

/** The :key of a route, in its one form (normalized phone or lower-case email). 400 naming the field when it is neither. */
export function requireCustomerKey(raw: string): string {
  const key = normalizeCustomerKey(raw);
  if (key === null) throw new HttpError(400, 'The customer key must be a mobile number or an email address', ACCOUNT_CODES.BODY_INVALID, 'key');
  return key;
}

// ----------------------------------------------------------------------------------------------------------- search, filter

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The $match stage for a search text: name, email or phone, case-insensitive. The text is ESCAPED and used only as a literal
 * pattern, so no character of it is ever a regex operator. A phone typed in any spelling (0300 1234567, +92 300..., 300-123)
 * also matches the stored +923... number, through its digits without the 0 or 92 in front. Null for an empty text.
 */
export function customerSearchStage(q: string | undefined): Row | null {
  const raw = (q ?? '').trim();
  if (raw === '') return null;
  const literal = escapeRegex(raw);
  const or: Row[] = [{ name: { $regex: literal, $options: 'i' } }, { email: { $regex: literal, $options: 'i' } }];
  if (/^[\d\s+().-]+$/.test(raw)) {
    const tail = raw.replace(/\D/g, '').replace(/^(0092|92|0)/, '');
    if (tail.length >= 3) or.push({ phone: { $regex: escapeRegex(tail) } });
  }
  return { $match: { $or: or } };
}

const SORTS: Record<CustomerSort, Row> = {
  last_order: { lastOrderAt: -1, _id: 1 },
  total_spent: { totalSpent: -1, lastOrderAt: -1, _id: 1 },
  orders: { orders: -1, lastOrderAt: -1, _id: 1 },
};

type Filters = Pick<CustomerListQuery, 'phone' | 'q' | 'sort' | 'repeat' | 'hasEmail' | 'unsubscribed'>;

/** The stages after grouping: the filters, the search and the sort. Pure, so a test can read them. */
export function filterStages(filters: Filters, unsubscribedEmails: readonly string[]): Row[] {
  const stages: Row[] = [];
  if (filters.phone === '1') stages.push({ $match: { phone: { $nin: ['', null] } } });
  if (filters.repeat === '1') stages.push({ $match: { orders: { $gte: 2 } } });
  if (filters.hasEmail === '1') stages.push({ $match: { email: { $nin: ['', null] } } });
  if (filters.unsubscribed === '1') stages.push({ $match: { email: { $in: [...unsubscribedEmails] } } });
  const search = customerSearchStage(filters.q);
  if (search !== null) stages.push(search);
  stages.push({ $sort: SORTS[filters.sort ?? 'last_order'] });
  return stages;
}

export async function unsubscribedAmong(storeId: string, emails: readonly string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const rows = (await EmailUnsubscribe.find({ store: oid(storeId), email: { $in: [...emails] } })
    .select('email')
    .lean()) as unknown as Array<{ email?: string }>;
  return new Set(rows.map((row) => String(row.email ?? '').toLowerCase()));
}

/** Only for the "unsubscribed" filter: the store's unsubscribed addresses (bounded). */
async function allUnsubscribed(storeId: string): Promise<string[]> {
  const rows = (await EmailUnsubscribe.find({ store: oid(storeId) }).select('email').limit(UNSUBSCRIBED_SCAN_MAX).lean()) as unknown as Array<{ email?: string }>;
  return rows.map((row) => String(row.email ?? '').toLowerCase()).filter((email) => email !== '');
}

export interface NoteRow {
  key?: string;
  note?: string;
  tags?: string[];
  updatedAt?: Date | string;
}

async function notesFor(storeId: string, keys: readonly string[]): Promise<Map<string, NoteRow>> {
  if (keys.length === 0) return new Map();
  const rows = (await CustomerNote.find({ store: oid(storeId), key: { $in: [...keys] } })
    .select('key note tags updatedAt')
    .lean()) as unknown as NoteRow[];
  return new Map(rows.map((row) => [String(row.key ?? ''), row]));
}

// ------------------------------------------------------------------------------------------------------------------- rows

/** The statistics of a group. `returnsCount` is read by the caller (the one helper returnsCountFor) because it is not part of the orders pipeline. */
export function statsOf(group: CustomerGroup, returnsCount: number = 0): CustomerStats {
  const delivered = whole(group.deliveredCount);
  const spent = whole(group.totalSpent);
  return {
    orderCount: whole(group.orders),
    deliveredCount: delivered,
    cancelledCount: whole(group.cancelledCount),
    totalSpent: spent,
    averageOrderValue: delivered > 0 ? Math.round(spent / delivered) : 0,
    firstOrderAt: iso(group.firstOrderAt),
    lastOrderAt: iso(group.lastOrderAt),
    // Sprint 5 EP-13.US03.T05: the real count of this customer's returns (not rejected), by phoneKey: returnsCountFor.
    returnsCount: whole(returnsCount),
  };
}

function toRow(group: CustomerGroup, unsubscribed: ReadonlySet<string>, notes: ReadonlyMap<string, NoteRow>): CustomerRow {
  const email = text(group.email);
  const stats = statsOf(group);
  return {
    id: String(group._id),
    name: text(group.name),
    email,
    phone: text(group.phone),
    whatsapp: text(group.whatsapp),
    orderCount: stats.orderCount,
    lastOrderAt: stats.lastOrderAt,
    unsubscribed: email !== null && unsubscribed.has(email),
    deliveredCount: stats.deliveredCount,
    totalSpent: stats.totalSpent,
    tags: notes.get(String(group._id))?.tags ?? [],
  };
}

const aggregateGroups = async (pipeline: Row[]): Promise<Array<{ rows?: CustomerGroup[]; total?: Array<{ n?: number }> }>> =>
  (await Order.aggregate(pipeline as unknown as PipelineStage[])) as unknown as Array<{ rows?: CustomerGroup[]; total?: Array<{ n?: number }> }>;

// -------------------------------------------------------------------------------------------------------------------- list

/** One page of the store's customers: search, filters, sort and paging. `phone: '1'` keeps the customers with a phone (the WhatsApp list). */
export async function listCustomers(storeId: string, query: CustomerListQuery): Promise<CustomerList> {
  const unsubscribedEmails = query.unsubscribed === '1' ? await allUnsubscribed(storeId) : [];
  const pipeline = [
    ...customerStages(storeId),
    ...filterStages(query, unsubscribedEmails),
    { $facet: { rows: [{ $skip: (query.page - 1) * query.limit }, { $limit: query.limit }], total: [{ $count: 'n' }] } },
  ];
  const facets = await aggregateGroups(pipeline);
  const rows = facets[0]?.rows ?? [];
  const totalDocs = facets[0]?.total?.[0]?.n ?? 0;
  const [unsubscribed, notes] = await Promise.all([
    unsubscribedAmong(storeId, rows.map((row) => text(row.email)).filter((email): email is string => email !== null)),
    notesFor(storeId, rows.map((row) => String(row._id))),
  ]);
  return {
    docs: rows.map((row) => toRow(row, unsubscribed, notes)),
    page: query.page,
    limit: query.limit,
    totalDocs,
    totalPages: Math.ceil(totalDocs / query.limit),
  };
}

// ------------------------------------------------------------------------------------------------------------------ detail

/** True when the store has at least one order that belongs to this customer key. A key of another store has none. */
export async function customerExists(storeId: string, key: string): Promise<boolean> {
  const rows = (await Order.aggregate([...keyedOrderStages(storeId, key), { $limit: 1 }, { $project: { _id: 1 } }] as unknown as PipelineStage[])) as unknown as Row[];
  return rows.length > 0;
}

export interface OrderLine {
  _id?: unknown;
  orderId?: string;
  createdAt?: Date | string;
  status?: string;
  total?: number;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  address?: string | null;
  city?: string | null;
}

/** Distinct delivery addresses, newest first (the orders arrive newest first), at most `max`. */
export function distinctAddresses(orders: readonly OrderLine[], max: number = CUSTOMER_DETAIL_ADDRESSES_MAX): CustomerAddress[] {
  const seen = new Set<string>();
  const out: CustomerAddress[] = [];
  for (const order of orders) {
    const address = text(order.address);
    if (address === null) continue;
    const city = text(order.city);
    const key = address.toLowerCase().replace(/\s+/g, ' ') + '|' + (city ?? '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ address, city });
    if (out.length >= max) break;
  }
  return out;
}

/** The customer, or null when this store has no such customer (the route answers 404). One aggregation for the statistics, one for the orders. */
export async function getCustomerDetail(storeId: string, key: string): Promise<CustomerDetail | null> {
  const groups = (await Order.aggregate(customerStages(storeId, key) as unknown as PipelineStage[])) as unknown as CustomerGroup[];
  const group = groups[0];
  if (!group) return null;

  const orderPipeline = [
    ...keyedOrderStages(storeId, key),
    { $sort: { createdAt: -1, _id: -1 } },
    { $limit: CUSTOMER_DETAIL_ORDERS_MAX },
    { $project: { orderId: 1, createdAt: 1, status: 1, total: 1, paymentMethod: 1, paymentStatus: 1, address: 1, city: 1 } },
  ];
  const email = text(group.email);
  const [orderLines, notes, unsubscribed, returnsCount] = await Promise.all([
    Order.aggregate(orderPipeline as unknown as PipelineStage[]) as unknown as Promise<OrderLine[]>,
    notesFor(storeId, [key]),
    unsubscribedAmong(storeId, email === null ? [] : [email]),
    // A customer known only by email has no phone key, so no returns to count.
    returnsCountFor(storeId, key),
  ]);
  const note = notes.get(key);
  const orders: CustomerOrderRow[] = orderLines.map((line) => ({
    id: String(line._id ?? ''),
    orderId: String(line.orderId ?? ''),
    createdAt: iso(line.createdAt) ?? '',
    status: String(line.status ?? ''),
    total: whole(line.total),
    paymentMethod: line.paymentMethod ?? null,
    paymentStatus: String(line.paymentStatus ?? 'unpaid'),
  }));
  return {
    id: String(group._id),
    name: text(group.name),
    email,
    phone: text(group.phone),
    whatsapp: text(group.whatsapp),
    unsubscribed: email !== null && unsubscribed.has(email),
    stats: statsOf(group, returnsCount),
    note: note?.note ?? '',
    tags: note?.tags ?? [],
    noteUpdatedAt: iso(note?.updatedAt),
    orders,
    addresses: distinctAddresses(orderLines),
  };
}

// ------------------------------------------------------------------------------------------------------------ address book

/** The form an address is compared in: trimmed, lower case, runs of space as one. */
const addressForm = (value: string | null): string => (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Sprint 5 EP-10.US03.T01: a customer's distinct delivery addresses taken from their orders. Two orders with the same address and city
 * (trimmed, lower case) are one entry, with how many orders used it and when it was last used, newest first. The entry shows the
 * spelling of the newest order that used it. An order with no address adds none. Pure: the route reads the orders.
 */
export function addressBookOf(orders: readonly OrderLine[], max: number = ADDRESS_BOOK_MAX): CustomerAddressEntry[] {
  const dated = orders
    .map((order) => ({ order, at: iso(order.createdAt) ?? '' }))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const groups = new Map<string, CustomerAddressEntry>();
  for (const { order, at } of dated) {
    const address = text(order.address);
    if (address === null) continue;
    const city = text(order.city);
    const key = addressForm(address) + '|' + addressForm(city);
    const found = groups.get(key);
    if (found) {
      found.orderCount += 1;
      continue;
    }
    // The orders arrive newest first, so the first one seen is the newest: its spelling and date stand for the entry.
    groups.set(key, { address, city, orderCount: 1, lastUsedAt: at });
  }
  return [...groups.values()].slice(0, max);
}

/**
 * The address book of ONE customer of ONE store (D-107: seller side only, nothing is prefilled on the storefront). The store is in the
 * first $match of the pipeline. Reads at most ADDRESS_BOOK_SCAN_MAX of the newest orders. Null when this store has no such customer
 * (the route answers 404): another store's customer is simply not found.
 */
export async function getCustomerAddressBook(storeId: string, key: string): Promise<CustomerAddressBook | null> {
  const pipeline = [
    ...keyedOrderStages(storeId, key),
    { $sort: { createdAt: -1, _id: -1 } },
    { $limit: ADDRESS_BOOK_SCAN_MAX },
    { $project: { address: 1, city: 1, createdAt: 1 } },
  ];
  const rows = (await Order.aggregate(pipeline as unknown as PipelineStage[])) as unknown as OrderLine[];
  if (rows.length === 0) return null;
  return { addresses: addressBookOf(rows) };
}

// -------------------------------------------------------------------------------------------------------------------- note

/**
 * Saves the seller's note and tags for a customer of this store: ONE upsert on the unique { store, key }. Only the fields sent
 * are written. Two saves racing on a new customer both upsert; the loser of the unique index retries once as a plain update.
 * The caller has already checked the customer exists in this store, and never writes the text anywhere else (not the audit entry).
 */
export async function saveCustomerNote(ctx: Pick<AuthContext, 'userObjectId'>, storeId: string, key: string, input: CustomerNoteRequest): Promise<CustomerNoteResult> {
  const set: Row = { updatedBy: ctx.userObjectId };
  if (input.note !== undefined) set.note = input.note;
  if (input.tags !== undefined) set.tags = input.tags;
  const write = () =>
    CustomerNote.findOneAndUpdate({ store: oid(storeId), key }, { $set: set }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true })
      .select('note tags updatedAt')
      .lean() as unknown as Promise<NoteRow | null>;
  let saved: NoteRow | null;
  try {
    saved = await write();
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    saved = await write();
  }
  return { note: saved?.note ?? '', tags: saved?.tags ?? [], updatedAt: iso(saved?.updatedAt) ?? new Date().toISOString() };
}

// ------------------------------------------------------------------------------------------------------------------- export

export interface CustomerExport {
  csv: string;
  rows: number;
  /** True when the store has more customers than the cap: the file holds the first CUSTOMER_EXPORT_MAX_ROWS. */
  truncated: boolean;
}

const yesNo = (value: boolean): string => (value ? 'yes' : 'no');

/** The CSV text: UTF-8 BOM, quoted cells, and every cell that starts with = + - @ (or a tab or CR) neutralised by serializeCsv. Pure. */
export function customersCsv(rows: readonly CustomerRow[]): string {
  const records: string[][] = [[...CUSTOMER_CSV_COLUMNS]];
  for (const row of rows) {
    records.push([
      row.name ?? '',
      row.phone ?? '',
      row.email ?? '',
      String(row.orderCount),
      String(row.deliveredCount),
      String(row.totalSpent),
      row.lastOrderAt === null ? '' : row.lastOrderAt.slice(0, 10),
      yesNo(row.unsubscribed),
    ]);
  }
  return serializeCsv(records);
}

/** The store's customers as a CSV, with the same filters and sort as the list, at most CUSTOMER_EXPORT_MAX_ROWS rows. */
export async function exportCustomers(storeId: string, query: CustomerExportQuery): Promise<CustomerExport> {
  const unsubscribedEmails = query.unsubscribed === '1' ? await allUnsubscribed(storeId) : [];
  const pipeline = [...customerStages(storeId), ...filterStages(query, unsubscribedEmails), { $limit: CUSTOMER_EXPORT_MAX_ROWS + 1 }];
  const groups = (await Order.aggregate(pipeline as unknown as PipelineStage[])) as unknown as CustomerGroup[];
  const truncated = groups.length > CUSTOMER_EXPORT_MAX_ROWS;
  const kept = truncated ? groups.slice(0, CUSTOMER_EXPORT_MAX_ROWS) : groups;
  const unsubscribed = await unsubscribedAmong(storeId, kept.map((group) => text(group.email)).filter((email): email is string => email !== null));
  const rows = kept.map((group) => toRow(group, unsubscribed, new Map()));
  return { csv: customersCsv(rows), rows: rows.length, truncated };
}

// --------------------------------------------------------------------------------------------------------- broadcast emails

/**
 * The distinct customer emails of the store, most recent buyer first (at most `limit`). The broadcast reads its recipients
 * here. It groups by EMAIL, independent of the phone grouping above, so a shopper who used two emails counts as two recipients
 * exactly as in Sprint 4, and the counts do not change for email-only data.
 */
export async function customerEmails(storeId: string, limit: number = RECIPIENT_SCAN_MAX): Promise<string[]> {
  const pipeline = [
    { $match: { store: oid(storeId) } },
    { $addFields: { _email: { $toLower: { $trim: { input: { $ifNull: ['$customerEmail', ''] } } } } } },
    { $match: { _email: { $ne: '' } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$_email', email: { $first: '$_email' }, lastOrderAt: { $max: '$createdAt' } } },
    { $sort: { lastOrderAt: -1, _id: 1 } },
    { $limit: limit },
  ];
  const groups = (await Order.aggregate(pipeline as unknown as PipelineStage[])) as unknown as Array<{ email?: string }>;
  return groups.map((group) => String(group.email ?? ''));
}
