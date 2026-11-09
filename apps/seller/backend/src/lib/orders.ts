import mongoose from 'mongoose';
import { NextResponse } from 'next/server';
import type {
  DashboardOrderCounts,
  DashboardOrderDisplayStatus,
  DashboardOrderDetail,
  DashboardOrderListItem,
  DashboardOrderListQuery,
  OrderPrintSheet,
  DashboardOrderNote,
  DashboardOrderPaymentMethod,
  DashboardOrderPaymentStatus,
  DashboardOrderStatus,
  DashboardOrderStatusChange,
} from '@markaz/contracts';
import {
  buildOrderTimeline,
  labelCodAmount,
  ORDER_PRINT_MAX_IDS,
  canCancel,
  canMarkCollected,
  DASHBOARD_ORDER_STATUSES,
  dashboardOrderListQuerySchema,
  nextStatuses,
  orderListDaySchema,
} from '@/lib/contracts';
import { HttpError, handleRouteError } from '@/lib/http';
import { escapeRegex } from '@/lib/storefront/product-query';

/*
 * EP-02 OB-1b: the seller dashboard's order list and detail. Everything here is pure: query parsing, the Mongo filters
 * and the mapping from a stored order (hydrated or .lean(), written before or after EP-02) to the dashboard shapes.
 * The routes do the reading.
 */

export type OrderErrorCode =
  | 'ORDER_STATUS_INVALID'
  | 'ORDER_DATE_INVALID'
  | 'ORDER_DATE_RANGE_INVALID'
  | 'ORDER_PAGE_INVALID'
  | 'ORDER_LIMIT_INVALID'
  | 'ORDER_QUERY_INVALID'
  // EP-02 OB-2: the transition endpoint.
  | 'ORDER_BODY_INVALID'
  | 'ORDER_TRANSITION_ILLEGAL'
  | 'ORDER_STATUS_CHANGED'
  // EP-02 OB-3: the cancel endpoint.
  | 'ORDER_CANCEL_ILLEGAL'
  // EP-02 OB-4: the tracking edit.
  | 'ORDER_TRACKING_ILLEGAL'
  // EP-02 OB-5a: payment and notes.
  | 'PAYMENT_NOT_COD'
  | 'PAYMENT_NOT_ALLOWED'
  | 'PAYMENT_AMOUNT_MISMATCH'
  | 'ORDER_NOTES_FULL';

export class OrderRequestError extends HttpError {
  readonly code: OrderErrorCode;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: OrderErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(status, message);
    this.name = 'OrderRequestError';
    this.code = code;
    this.details = details;
  }
}

/** handleRouteError with the order codes kept: { errors: [{ message, code, ...details }] }, as the product routes answer. */
export function handleOrderError(err: unknown): NextResponse {
  if (err instanceof OrderRequestError) {
    return NextResponse.json({ errors: [{ message: err.message, code: err.code, ...err.details }] }, { status: err.status });
  }
  return handleRouteError(err);
}

interface BodySchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> } };
}

/** Parses a JSON request body with a contract schema. Anything wrong is 400 ORDER_BODY_INVALID naming the field. */
export async function readOrderBody<T>(request: Request, schema: BodySchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new OrderRequestError(400, 'ORDER_BODY_INVALID', 'The request body must be a JSON object.', { field: null });
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const field = issue?.path.length ? String(issue.path[0]) : null;
  throw new OrderRequestError(400, 'ORDER_BODY_INVALID', (field ? field + ': ' : '') + (issue?.message ?? 'Invalid body.'), { field });
}

// ---------------------------------------------------------------------------------------------------------------------
// Query

/** The new list parameters. When any of them is sent, the legacy ?where and ?sort are ignored. */
const LIST_FILTER_PARAMS = ['status', 'from', 'to', 'q'] as const;
const LIST_PARAMS = [...LIST_FILTER_PARAMS, 'page', 'limit'] as const;

export type OrderListRequest = { mode: 'legacy' } | { mode: 'list'; query: DashboardOrderListQuery };

/**
 * Which kind of request this is. A caller that sends ?where or ?sort and none of status, from, to or q keeps the generic
 * behaviour it had before EP-02 (the store overview page reads totals that way, with limit up to 1000). Every other
 * request is the new list: validated parameters, 400 with a code for a bad value.
 */
export function parseOrderListRequest(params: URLSearchParams): OrderListRequest {
  const usesNewFilter = LIST_FILTER_PARAMS.some((name) => params.has(name));
  const usesLegacy = params.has('where') || params.has('sort');
  if (usesLegacy && !usesNewFilter) return { mode: 'legacy' };

  const raw: Record<string, string> = {};
  for (const name of LIST_PARAMS) {
    const value = params.get(name);
    // An empty parameter (a form submitted with an empty field) means "not set".
    if (value !== null && value.trim() !== '') raw[name] = value;
  }
  const parsed = dashboardOrderListQuerySchema.safeParse(raw);
  if (!parsed.success) throw queryError(String(parsed.error.issues[0]?.path[0] ?? ''), raw);
  return { mode: 'list', query: parsed.data };
}

const isRealDay = (value: string | undefined): boolean => value !== undefined && orderListDaySchema.safeParse(value).success;

function queryError(field: string, raw: Record<string, string>): OrderRequestError {
  if (field === 'status') {
    return new OrderRequestError(400, 'ORDER_STATUS_INVALID', 'status must be one of: ' + DASHBOARD_ORDER_STATUSES.join(', '));
  }
  // Both days are real dates on their own, so what failed is their order.
  if ((field === 'from' || field === 'to') && isRealDay(raw.from) && isRealDay(raw.to)) {
    return new OrderRequestError(400, 'ORDER_DATE_RANGE_INVALID', 'from must be on or before to.');
  }
  if (field === 'from' || field === 'to') {
    return new OrderRequestError(400, 'ORDER_DATE_INVALID', field + ' must be a real date in the format YYYY-MM-DD.');
  }
  if (field === 'page') return new OrderRequestError(400, 'ORDER_PAGE_INVALID', 'page must be a whole number from 1 to 100000.');
  if (field === 'limit') return new OrderRequestError(400, 'ORDER_LIMIT_INVALID', 'limit must be a whole number of 1 or more.');
  return new OrderRequestError(400, 'ORDER_QUERY_INVALID', 'The order list query is not valid.');
}

// ---------------------------------------------------------------------------------------------------------------------
// Filters

/** Pakistan Standard Time has no daylight saving: always UTC+05:00. */
const PAKISTAN_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant a Pakistan calendar day (YYYY-MM-DD) starts. */
export function pakistanDayStart(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - PAKISTAN_OFFSET_MS);
}

/** createdAt bounds for an inclusive from..to in Pakistan time, or null when neither is set. */
export function createdAtRange(from?: string, to?: string): Record<string, Date> | null {
  if (from === undefined && to === undefined) return null;
  const range: Record<string, Date> = {};
  if (from !== undefined) range.$gte = pakistanDayStart(from);
  if (to !== undefined) range.$lt = new Date(pakistanDayStart(to).getTime() + DAY_MS);
  return range;
}

const ORDER_NUMBER_PREFIX = /^ord-/i;
const PHONE_TEXT = /^\+?\d+$/;

/**
 * The search filter (D-070). Every branch builds its regex from escaped text, so . * ( [ \ and friends match themselves.
 *   ORD-...        order number prefix, uppercased (order numbers are stored uppercase), anchored so the index is used
 *   +?digits       phone prefix, anchored; 03xx is also tried as +923xx and +92xx as 0xx, because checkout stores E.164
 *                  and older orders may hold the local form
 *   anything else  case-insensitive "contains" on the customer name
 */
export function orderSearchFilter(q: string | undefined): Record<string, unknown> | null {
  const text = (q ?? '').trim();
  if (text === '') return null;

  if (ORDER_NUMBER_PREFIX.test(text)) {
    return { orderId: { $regex: '^' + escapeRegex(text.toUpperCase()) } };
  }

  if (PHONE_TEXT.test(text)) {
    const forms = new Set<string>([text]);
    if (text.startsWith('0')) forms.add('+92' + text.slice(1));
    if (text.startsWith('+92')) forms.add('0' + text.slice(3));
    const alternatives = [...forms].map((form) => ({ phone: { $regex: '^' + escapeRegex(form) } }));
    return alternatives.length === 1 ? alternatives[0] : { $or: alternatives };
  }

  return { customerName: { $regex: escapeRegex(text), $options: 'i' } };
}

export interface OrderListFilters {
  /** Store, dates and search, without the status: what the per-status counts read. */
  counts: Record<string, unknown>;
  /** The counts filter plus the status, when one is chosen: what the list reads. */
  list: Record<string, unknown>;
}

/**
 * Both filters for one list request. The store is an ObjectId, not a string, because the counts go through aggregate(),
 * which Mongoose does not cast.
 */
export function orderListFilters(storeId: string, query: DashboardOrderListQuery): OrderListFilters {
  const counts: Record<string, unknown> = { store: new mongoose.Types.ObjectId(storeId) };
  const range = createdAtRange(query.from, query.to);
  if (range) counts.createdAt = range;
  const search = orderSearchFilter(query.q);
  if (search) Object.assign(counts, search);
  const list = query.status ? { ...counts, status: query.status } : { ...counts };
  return { counts, list };
}

/** Newest first; _id breaks ties so pages never overlap. */
export const ORDER_LIST_SORT = { createdAt: -1, _id: -1 } as const;

/** The $group rows of the counts aggregate, folded into one object with every status present. */
export function toOrderCounts(groups: ReadonlyArray<{ _id: unknown; count: unknown }>): DashboardOrderCounts {
  const counts: DashboardOrderCounts = {
    all: 0,
    pending: 0,
    confirmed: 0,
    processing: 0,
    dispatched: 0,
    delivered: 0,
    cancelled: 0,
    returned: 0,
  };
  for (const group of groups) {
    const n = typeof group.count === 'number' ? group.count : Number(group.count) || 0;
    counts.all += n;
    const status = String(group._id) as DashboardOrderStatus;
    if ((DASHBOARD_ORDER_STATUSES as readonly string[]).includes(status)) counts[status] += n;
  }
  return counts;
}

// ---------------------------------------------------------------------------------------------------------------------
// Mapping

type Row = Record<string, unknown>;

/** A hydrated document or a .lean() row, as plain JSON: ObjectIds and dates become strings. */
function plainRow(doc: unknown): Row {
  const maybe = doc as { toObject?: () => unknown };
  const value = typeof maybe?.toObject === 'function' ? maybe.toObject() : doc;
  return JSON.parse(JSON.stringify(value ?? {})) as Row;
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const numOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const id = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const list = (value: unknown): Row[] => (Array.isArray(value) ? (value as Row[]) : []);

function iso(value: unknown): string | null {
  if (typeof value === 'string' && value !== '') return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return null;
}

const isStatus = (value: unknown): value is DashboardOrderStatus =>
  typeof value === 'string' && (DASHBOARD_ORDER_STATUSES as readonly string[]).includes(value);

/** A stored value outside the seven is shown as unknown. It must not look like an order waiting to be confirmed. */
function status(value: unknown): DashboardOrderDisplayStatus {
  return isStatus(value) ? value : 'unknown';
}

function paymentMethod(value: unknown): DashboardOrderPaymentMethod | null {
  return value === 'cod' || value === 'card' ? value : null;
}

/** Missing (an order written before EP-02) reads as unpaid. */
function paymentStatus(value: unknown): DashboardOrderPaymentStatus {
  return value === 'collected' ? 'collected' : 'unpaid';
}

/** Money in whole PKR with no floating-point noise. */
const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/** Newest first. Entries without a usable time keep their stored order at the end. */
function newestFirst<T extends { at: string }>(entries: T[]): T[] {
  return entries
    .map((entry, index) => ({ entry, index, time: Date.parse(entry.at) }))
    .sort((a, b) => (Number.isNaN(b.time) ? -1 : Number.isNaN(a.time) ? 1 : b.time - a.time || b.index - a.index))
    .map(({ entry }) => entry);
}

/** The usable history entries in the order they were written. */
function historyEntries(value: unknown): Array<DashboardOrderStatusChange & { kind: string | null }> {
  return list(value)
    .filter((entry) => isStatus(entry.from) && isStatus(entry.to))
    .map((entry) => ({
      from: entry.from as DashboardOrderStatus,
      to: entry.to as DashboardOrderStatus,
      by: id(entry.by),
      at: iso(entry.at) ?? '',
      note: text(entry.note),
      kind: text(entry.kind),
    }))
    .filter((entry) => entry.at !== '');
}

/** The usable notes in the order they were written. */
function noteEntries(value: unknown): DashboardOrderNote[] {
  return list(value)
    .filter((entry) => typeof entry.text === 'string')
    .map((entry) => ({ id: id(entry._id), text: entry.text as string, by: id(entry.by), at: iso(entry.at) ?? '' }))
    .filter((entry) => entry.at !== '');
}

/**
 * One row of the list. Built field by field from an allowlist, so idempotencyKey, requestFingerprint, internal notes
 * and anything else stored can never reach the response.
 */
export function toDashboardOrderListItem(doc: unknown): DashboardOrderListItem {
  const row = plainRow(doc);
  return {
    id: String(row._id ?? ''),
    orderId: String(row.orderId ?? ''),
    status: status(row.status),
    paymentMethod: paymentMethod(row.paymentMethod),
    paymentStatus: paymentStatus(row.paymentStatus),
    customerName: text(row.customerName),
    phone: text(row.phone),
    city: text(row.city),
    total: num(row.total),
    itemCount: list(row.items).reduce((sum, item) => sum + num(item.quantity), 0),
    courier: text(row.courier),
    trackingNumber: text(row.trackingNumber),
    createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
  };
}

/**
 * The detail page's order, allowlisted the same way. statusHistory and notes are newest first. allowedNext comes from the
 * stored status as it is, and a corrupt status shows as unknown and has no legal moves.
 */
export function toDashboardOrderDetail(doc: unknown): DashboardOrderDetail {
  const row = plainRow(doc);
  const createdAt = iso(row.createdAt) ?? new Date(0).toISOString();
  const history = historyEntries(row.statusHistory);
  const orderNotes = noteEntries(row.notes);
  return {
    id: String(row._id ?? ''),
    orderId: String(row.orderId ?? ''),
    status: status(row.status),
    paymentMethod: paymentMethod(row.paymentMethod),
    paymentStatus: paymentStatus(row.paymentStatus),
    collectedAt: iso(row.collectedAt),
    collectedAmount: numOrNull(row.collectedAmount),
    customerName: text(row.customerName),
    phone: text(row.phone),
    address: text(row.address),
    city: text(row.city),
    items: list(row.items).map((item) => {
      const unitPrice = num(item.unitPrice);
      const quantity = num(item.quantity, 1);
      return {
        productTitle: String(item.productTitle ?? ''),
        variantTitle: String(item.variantTitle ?? ''),
        sku: text(item.sku),
        unitPrice,
        quantity,
        lineTotal: money(unitPrice * quantity),
        // D-066: null for an order placed before placement recorded it.
        stockDeducted: typeof item.stockDeducted === 'boolean' ? item.stockDeducted : null,
      };
    }),
    subtotal: num(row.subtotal),
    deliveryCharges: num(row.deliveryCharges),
    discountCode: text(row.discountCode),
    discountAmount: num(row.discountAmount),
    total: num(row.total),
    courier: text(row.courier),
    trackingNumber: text(row.trackingNumber),
    trackingUrl: text(row.trackingUrl),
    statusHistory: newestFirst(history.map(({ kind: _kind, ...entry }) => entry)),
    notes: newestFirst(orderNotes),
    cancelledAt: iso(row.cancelledAt),
    cancelReason: text(row.cancelReason),
    createdAt,
    updatedAt: iso(row.updatedAt) ?? createdAt,
    allowedNext: nextStatuses(row.status),
    canCancel: canCancel(row.status),
    canEditTracking: row.status === 'dispatched',
    canMarkCollected: canMarkCollected(row),
    timeline: buildOrderTimeline({ createdAt, statusHistory: history, notes: orderNotes, cancelReason: text(row.cancelReason) }),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Print (EP-02 OB-5b)

const OBJECT_ID_TEXT = /^[0-9a-f]{24}$/i;

/** The ?ids= list: comma separated, 1 to 50 after duplicates are dropped, first position kept, every id a 24-hex ObjectId. */
export function parseOrderPrintIds(raw: string | null): string[] {
  const invalid = (message: string): OrderRequestError => new OrderRequestError(400, 'ORDER_QUERY_INVALID', message, { field: 'ids' });
  if (raw === null || raw.trim() === '') throw invalid('ids is required: a comma-separated list of order ids.');
  const ids = raw.split(',').map((id) => id.trim().toLowerCase());
  if (ids.some((id) => !OBJECT_ID_TEXT.test(id))) throw invalid('ids holds a value that is not an order id.');
  const unique = [...new Set(ids)];
  if (unique.length > ORDER_PRINT_MAX_IDS) throw invalid('At most ' + ORDER_PRINT_MAX_IDS + ' orders can be printed at once.');
  return unique;
}

/** The fields a printout reads. Notes, history and the idempotency fields are never loaded. */
export const ORDER_PRINT_PROJECTION =
  'orderId createdAt status customerName phone address city items paymentMethod paymentStatus total courier trackingNumber';

/** One order as a label and a slip read it. Strings pass through whole; long values are the page's CSS problem. */
export function toOrderPrintSheet(doc: unknown): OrderPrintSheet {
  const row = plainRow(doc);
  return {
    id: String(row._id ?? ''),
    orderId: String(row.orderId ?? ''),
    createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
    status: String(row.status ?? ''),
    customerName: text(row.customerName),
    phone: text(row.phone),
    address: text(row.address),
    city: text(row.city),
    items: list(row.items).map((item) => ({
      title: String(item.productTitle ?? ''),
      variantTitle: typeof item.variantTitle === 'string' && item.variantTitle !== 'Default' ? item.variantTitle : null,
      sku: text(item.sku),
      qty: num(item.quantity, 1),
    })),
    paymentMethod: paymentMethod(row.paymentMethod),
    paymentStatus: paymentStatus(row.paymentStatus),
    codAmount: labelCodAmount(row),
    courier: text(row.courier),
    trackingNumber: text(row.trackingNumber),
  };
}
