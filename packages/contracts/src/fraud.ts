import { z } from 'zod';
import { normalizePhoneE164 } from './checkout';
import { matchPakistanCity } from './store-settings';
import type { CodConfirmationMode, RiskRules } from './store-settings';

/*
 * Sprint 5 EP-11 (D-107, D-108): phone confirmation of cash-on-delivery orders, the blocklist and the risk rules.
 *
 * The seller confirms a COD order by phone or WhatsApp (no SMS). A risk rule FLAGS an order and never rejects it; only a blocklist
 * hit is refused at checkout, with a neutral message that never says the contact is blocked. Amounts are whole rupees.
 */

// ------------------------------------------------------------------------------------------------------------------- order

/** Order.confirmationStatus. An order written before this field existed (or a card order) reads as not_required. */
export const CONFIRMATION_STATUSES = ['not_required', 'unconfirmed', 'confirmed', 'unreachable'] as const;
export type ConfirmationStatus = (typeof CONFIRMATION_STATUSES)[number];

/** What the seller can decide. cancel goes through the normal cancel path (stock and discount use go back once). */
export const CONFIRMATION_RESULTS = ['confirmed', 'unreachable', 'cancel'] as const;
export type ConfirmationResult = (typeof CONFIRMATION_RESULTS)[number];

/** What a confirmationLog entry records: the decision as it happened (cancel is logged as cancelled). */
export const CONFIRMATION_LOG_RESULTS = ['confirmed', 'unreachable', 'cancelled'] as const;
export type ConfirmationLogResult = (typeof CONFIRMATION_LOG_RESULTS)[number];

/** The reasons an order can be flagged (D-107). */
export const RISK_FLAGS = ['high_value', 'flagged_city', 'repeat_returns', 'new_customer'] as const;
export type RiskFlag = (typeof RISK_FLAGS)[number];

/** Plain words for each flag, shown on the order list and detail. */
export const RISK_FLAG_LABELS: Readonly<Record<RiskFlag, string>> = {
  high_value: 'High order value',
  flagged_city: 'Flagged city',
  repeat_returns: 'Often returns orders',
  new_customer: 'New customer',
};

/** The most entries Order.confirmationLog holds. */
export const CONFIRMATION_LOG_MAX = 20;
/** The longest note on one decision. Same number as the Order model. */
export const CONFIRMATION_NOTE_MAX = 200;

/** The 422 that refuses to dispatch an order the seller has not confirmed yet. */
export const ORDER_NOT_CONFIRMED = 'ORDER_NOT_CONFIRMED';
export const ORDER_NOT_CONFIRMED_MESSAGE = 'Confirm this order with the customer before you dispatch it.';
/** The 409 answer to a second decision on the same order. */
export const ORDER_CONFIRMATION_DECIDED = 'ORDER_CONFIRMATION_DECIDED';

/** A stored value read leniently: anything that is not one of the four reads as not_required. */
export function readConfirmationStatus(value: unknown): ConfirmationStatus {
  return (CONFIRMATION_STATUSES as readonly string[]).includes(String(value)) ? (value as ConfirmationStatus) : 'not_required';
}

/** The stored flags that are real flags, each once, in the fixed order. */
export function readRiskFlags(value: unknown): RiskFlag[] {
  const stored = Array.isArray(value) ? value.map(String) : [];
  return RISK_FLAGS.filter((flag) => stored.includes(flag));
}

const NO_HTML = /[<>]/;

/** One line of plain text: controls become spaces, runs of space one space, trimmed. */
function plainLine(max: number, label: string) {
  return z
    .string({ error: label + ' must be text' })
    .transform((value) => value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(max, label + ' can be at most ' + max + ' characters').refine((value) => !NO_HTML.test(value), label + ' cannot contain < or >'));
}

/** POST /api/stores/:id/orders/:orderId/confirmation. Strict. An empty note is the same as none. */
export const orderConfirmationRequestSchema = z
  .object({
    result: z.enum(CONFIRMATION_RESULTS, { error: 'choose confirmed, unreachable or cancel' }),
    note: plainLine(CONFIRMATION_NOTE_MAX, 'note').optional(),
  })
  .strict()
  .transform((value) => ({ result: value.result, note: value.note === undefined || value.note === '' ? null : value.note }));
export type OrderConfirmationRequest = z.output<typeof orderConfirmationRequestSchema>;

export interface OrderConfirmationLogEntry {
  at: string;
  /** The user id of whoever decided. */
  by: string | null;
  result: ConfirmationLogResult;
  note: string | null;
}

/** 200 from the confirmation route: what was decided and the order as the dashboard reads it. */
export interface OrderConfirmationResponse {
  result: ConfirmationLogResult;
  confirmationStatus: ConfirmationStatus;
}

// ------------------------------------------------------------------------------------------------------------------ rules

export interface RiskInput {
  mode: CodConfirmationMode;
  rules: RiskRules;
  paymentMethod: string | null | undefined;
  total: number;
  city: string | null | undefined;
  /** What the store knows about this customer. */
  returnsCount: number;
  hasEarlierOrder: boolean;
}

export interface RiskAssessment {
  riskFlags: RiskFlag[];
  confirmationStatus: ConfirmationStatus;
}

/**
 * The ONE rule for a new order (D-107). Mode off switches the whole feature off: no flags, not_required. Otherwise the four flags
 * are worked out; in mode flagged any flag makes a COD order unconfirmed, in mode all every COD order is. A card order is never
 * unconfirmed. The flags never reject an order.
 */
export function assessOrderRisk(input: RiskInput): RiskAssessment {
  if (input.mode === 'off') return { riskFlags: [], confirmationStatus: 'not_required' };
  const flags: RiskFlag[] = [];
  const { rules } = input;
  if (rules.flagOrderValueAbove !== null && input.total > rules.flagOrderValueAbove) flags.push('high_value');
  if (input.city && matchPakistanCity(input.city) !== null && rules.flaggedCities.some((city) => matchPakistanCity(city) === matchPakistanCity(input.city))) {
    flags.push('flagged_city');
  }
  if (rules.flagReturnsAtLeast !== null && input.returnsCount >= rules.flagReturnsAtLeast) flags.push('repeat_returns');
  if (!input.hasEarlierOrder) flags.push('new_customer');
  const cod = input.paymentMethod === 'cod';
  const unconfirmed = cod && (input.mode === 'all' || flags.length > 0);
  return { riskFlags: flags, confirmationStatus: unconfirmed ? 'unconfirmed' : 'not_required' };
}

// -------------------------------------------------------------------------------------------------------------- blocklist

export const BLOCK_KINDS = ['phone', 'email'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];
/** At most this many blocked contacts per store. */
export const BLOCKLIST_MAX = 500;
export const BLOCK_REASON_MAX = 100;

/** The neutral sentence a blocked shopper sees: it never says the contact is blocked. */
export const CONTACT_BLOCKED = 'CONTACT_BLOCKED';
export const CONTACT_BLOCKED_MESSAGE = 'We cannot take this order. Please contact the store.';

const BLOCK_EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;

/** The stored form of a blocked value: the normalized phone (+923xxxxxxxxx) or the lower-case email. Null when it is neither. */
export function normalizeBlockValue(kind: BlockKind, value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '' || text.length > 254) return null;
  if (kind === 'phone') return normalizePhoneE164(text);
  const email = text.toLowerCase();
  return BLOCK_EMAIL.test(email) ? email : null;
}

/** POST /api/stores/:id/blocklist. Strict. value is stored normalized; a value that is not a mobile number or an email is a 400 on `value`. */
export const blockedContactRequestSchema = z
  .object({
    kind: z.enum(BLOCK_KINDS, { error: 'choose phone or email' }),
    value: z.string({ error: 'value must be text' }),
    reason: plainLine(BLOCK_REASON_MAX, 'reason').optional(),
  })
  .strict()
  .superRefine((body, context) => {
    if (normalizeBlockValue(body.kind, body.value) === null) {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: body.kind === 'phone' ? 'enter a valid mobile number, for example 0300 1234567' : 'enter a valid email address',
      });
    }
  })
  .transform((body) => ({ kind: body.kind, value: normalizeBlockValue(body.kind, body.value) as string, reason: body.reason ?? '' }));
export type BlockedContactRequest = z.output<typeof blockedContactRequestSchema>;

export interface BlockedContactRow {
  id: string;
  kind: BlockKind;
  value: string;
  reason: string;
  createdAt: string;
}

export interface BlockedContactList {
  docs: BlockedContactRow[];
  total: number;
  limit: number;
}

// ------------------------------------------------------------------------------------------------------------ address book

/** One delivery address of a customer: the same address (trimmed, lower case) counts once. */
export interface CustomerAddressEntry {
  address: string;
  city: string | null;
  /** How many of the customer's orders used it. */
  orderCount: number;
  /** The newest order that used it. */
  lastUsedAt: string;
}

export interface CustomerAddressBook {
  addresses: CustomerAddressEntry[];
}

/** At most this many orders are read to build an address book. */
export const ADDRESS_BOOK_SCAN_MAX = 500;
/** At most this many addresses are listed. */
export const ADDRESS_BOOK_MAX = 20;
