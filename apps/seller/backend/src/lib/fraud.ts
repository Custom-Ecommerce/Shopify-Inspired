import type { BlockedContactRow, ConfirmationLogResult, FraudSettings, OrderConfirmationLogEntry, RiskAssessment, RiskFlag } from '@markaz/contracts';
import {
  DEFAULT_FRAUD_SETTINGS,
  assessOrderRisk,
  matchPakistanCity,
  readConfirmationStatus,
  readRiskFlags,
} from '@/lib/contracts';
import { oid } from '@/lib/ledger-aggregates';
import { BlockedContact, Order } from '@/lib/services';
import { returnsCountFor } from '@/lib/returns';
import { phoneKeyOf } from '@/lib/storefront/order-phone';

/*
 * Sprint 5 EP-11 (D-107, D-108): everything the seller backend knows about phone confirmation, risk rules and the blocklist, in one
 * place. The rules themselves are pure and live in @markaz/contracts (assessOrderRisk); this module reads the store's settings,
 * asks the database the two questions a new order needs answered, and maps what is stored to what is sent.
 *
 * Where the settings live: Store.paymentSettings.fraud (Mixed). It is NOT inside Store.storefront, which the public storefront
 * reads, so a risk threshold or a city list never reaches a shopper's browser.
 */

type Row = Record<string, unknown>;

const record = (value: unknown): Row => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Row) : {});

// ------------------------------------------------------------------------------------------------------------- settings

/** Whole rupees of at least 1, else null ("no such rule"). */
function ruleAmount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.round(value) : null;
}

/** 1 to 10 returns, else null. */
function ruleReturns(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10 ? value : null;
}

/**
 * The fraud settings of a store, read leniently from paymentSettings (a store that never saved them, or holds something odd, gets
 * the defaults: mode off, no rules). Cities are matched to the shared list and kept once; at most 30.
 */
export function readFraud(paymentSettings: unknown): FraudSettings {
  const stored = record(record(paymentSettings).fraud);
  const rules = record(stored.riskRules);
  const mode = stored.codConfirmation;
  const cities: string[] = [];
  for (const entry of Array.isArray(rules.flaggedCities) ? (rules.flaggedCities as unknown[]) : []) {
    const city = matchPakistanCity(entry);
    if (city !== null && !cities.includes(city) && cities.length < 30) cities.push(city);
  }
  return {
    codConfirmation: mode === 'flagged' || mode === 'all' ? mode : DEFAULT_FRAUD_SETTINGS.codConfirmation,
    riskRules: {
      flagOrderValueAbove: ruleAmount(rules.flagOrderValueAbove),
      flaggedCities: cities,
      flagReturnsAtLeast: ruleReturns(rules.flagReturnsAtLeast),
    },
  };
}

// --------------------------------------------------------------------------------------------------------------- blocklist

/**
 * True when the phone (any spelling, compared as its phoneKey) or the email (lower case) is on the store's blocklist. ONE indexed
 * query on { store, kind, value }. Nothing is reserved yet when this runs, so a hit costs the store nothing.
 */
export async function isContactBlocked(storeId: string, contact: { phone?: unknown; email?: unknown }): Promise<boolean> {
  const or: Row[] = [];
  const phone = phoneKeyOf(contact.phone);
  if (phone !== undefined) or.push({ kind: 'phone', value: phone });
  const email = typeof contact.email === 'string' ? contact.email.trim().toLowerCase() : '';
  if (email !== '') or.push({ kind: 'email', value: email });
  if (or.length === 0) return false;
  return Boolean(await BlockedContact.exists({ store: oid(storeId), $or: or }));
}

export function toBlockedContactRow(doc: unknown): BlockedContactRow {
  const row = record(doc);
  const createdAt = row.createdAt instanceof Date ? row.createdAt.toISOString() : typeof row.createdAt === 'string' ? row.createdAt : new Date(0).toISOString();
  return {
    id: String(row._id ?? ''),
    kind: row.kind === 'email' ? 'email' : 'phone',
    value: typeof row.value === 'string' ? row.value : '',
    reason: typeof row.reason === 'string' ? row.reason : '',
    createdAt,
  };
}

// ------------------------------------------------------------------------------------------------------------ risk rules

/**
 * How many returns this customer has in this store (returns that were not rejected, by their phoneKey). Real since Sprint 5 SB-3 (D-109):
 * the SAME helper as the customer page's returns count, so the rule and the page cannot disagree. 0 for an order with no phone key.
 */
export async function returnsCountOf(storeId: string, phoneKey: string | undefined): Promise<number> {
  return returnsCountFor(storeId, phoneKey);
}

export interface RiskContext {
  storeId: string;
  settings: FraudSettings;
  paymentMethod: string | null | undefined;
  total: number;
  city: string | null | undefined;
  phone: unknown;
}

/**
 * The flags and the confirmation status of a new order (D-107). With the mode off nothing is read at all. Otherwise: is there an
 * earlier order with the same phoneKey (one indexed query on { store, phoneKey }), and the customer's returns count. The result
 * is stored on the order; it never rejects it.
 */
export async function assessNewOrder(context: RiskContext): Promise<RiskAssessment> {
  const { settings } = context;
  if (settings.codConfirmation === 'off') return assessOrderRisk({ mode: 'off', rules: settings.riskRules, paymentMethod: context.paymentMethod, total: context.total, city: context.city, returnsCount: 0, hasEarlierOrder: true });
  const key = phoneKeyOf(context.phone);
  const [earlier, returnsCount] = await Promise.all([
    key === undefined ? Promise.resolve(null) : Order.exists({ store: oid(context.storeId), phoneKey: key }),
    returnsCountOf(context.storeId, key),
  ]);
  return assessOrderRisk({
    mode: settings.codConfirmation,
    rules: settings.riskRules,
    paymentMethod: context.paymentMethod,
    total: context.total,
    city: context.city,
    returnsCount,
    // An order with no usable phone cannot be matched to an earlier one, so it is a "new customer" like any first order.
    hasEarlierOrder: Boolean(earlier),
  });
}

// ----------------------------------------------------------------------------------------------------------- order fields

/** The fields written onto a new order: nothing at all when the order carries no confirmation information. */
export function confirmationFieldsOf(assessment: RiskAssessment): Record<string, unknown> {
  if (assessment.confirmationStatus === 'not_required' && assessment.riskFlags.length === 0) return {};
  return {
    confirmationStatus: assessment.confirmationStatus,
    ...(assessment.riskFlags.length > 0 ? { riskFlags: assessment.riskFlags } : {}),
  };
}

/** The order's confirmation status as stored: an order with none (older, card, mode off) reads as not_required. */
export const confirmationStatusOf = (order: unknown): ReturnType<typeof readConfirmationStatus> => readConfirmationStatus(record(order).confirmationStatus);

export const riskFlagsOf = (order: unknown): RiskFlag[] => readRiskFlags(record(order).riskFlags);

/** The seller's decisions as the dashboard reads them, newest first. */
export function confirmationLogOf(order: unknown): OrderConfirmationLogEntry[] {
  const log = record(order).confirmationLog;
  const entries: OrderConfirmationLogEntry[] = [];
  for (const raw of Array.isArray(log) ? (log as unknown[]) : []) {
    const entry = record(raw);
    const at = entry.at instanceof Date ? entry.at.toISOString() : typeof entry.at === 'string' ? entry.at : '';
    if (at === '') continue;
    const result = entry.result;
    if (result !== 'confirmed' && result !== 'unreachable' && result !== 'cancelled') continue;
    entries.push({
      at,
      by: entry.by === null || entry.by === undefined ? null : String(entry.by),
      result: result as ConfirmationLogResult,
      note: typeof entry.note === 'string' && entry.note !== '' ? entry.note : null,
    });
  }
  return entries.reverse();
}
