import { z } from 'zod';

/*
 * The checkout contract: who is ordering and what the cart costs. One definition for the browser form, the BFF, the
 * seller backend's routes and the order service, so a rule cannot be changed on one side and forgotten on the other.
 * Only zod is imported here: the storefront bundles this file for the browser through @markaz/contracts/checkout.
 */

/* ------------------------------------------- phone ------------------------------------------- */

const PK_MOBILE_E164 = /^\+923\d{9}$/;

/** Urdu (U+06F0..) and Arabic (U+0660..) digits, as a phone keyboard set to either language types them. */
const EASTERN_DIGIT = /[٠-٩۰-۹]/g;

/** Direction and zero-width marks, which come along when a number is copied from right-to-left text. */
const INVISIBLE_MARK = /[​-‏‪-‮⁠⁦-⁩﻿]/g;

/** Spaces, brackets, dots and every kind of dash a phone or a word processor produces. */
const SEPARATOR = /[\s\-().‐-―−]/g;

function toAsciiDigit(digit: string): string {
  const code = digit.charCodeAt(0);
  return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
}

/**
 * The one stored form of a Pakistani mobile number: E.164, +923xxxxxxxxx. Null when the input is not one.
 *
 *   03001234567 | 3001234567 | 923001234567 | +923001234567 | 00923001234567
 *
 * Spaces, dashes, dots and brackets are ignored, and Urdu or Arabic digits count as digits. Pure, and also used to
 * compare a shopper's number with an order's, so a number that places an order can always look it up.
 */
export function normalizePhoneE164(input: unknown): string | null {
  if (typeof input !== 'string') return null;

  let value = input.replace(INVISIBLE_MARK, '').replace(EASTERN_DIGIT, toAsciiDigit).replace(SEPARATOR, '');
  if (value === '' || /[^\d+]/.test(value)) return null;
  if (value.lastIndexOf('+') > 0) return null;

  if (value.startsWith('+')) {
    // already carries a country code
  } else if (value.startsWith('00')) {
    value = '+' + value.slice(2);
  } else if (value.startsWith('92')) {
    value = '+' + value;
  } else if (value.startsWith('0')) {
    value = '+92' + value.slice(1);
  } else {
    value = '+92' + value;
  }

  return PK_MOBILE_E164.test(value) ? value : null;
}

/* ------------------------------------------- customer ------------------------------------------- */

export const CHECKOUT_NAME_MIN = 2;
export const CHECKOUT_NAME_MAX = 80;
export const CHECKOUT_PHONE_INPUT_MAX = 32;
export const CHECKOUT_ADDRESS_MIN = 10;
export const CHECKOUT_ADDRESS_MAX = 300;
export const CHECKOUT_CITY_MIN = 2;
export const CHECKOUT_CITY_MAX = 60;
export const CHECKOUT_EMAIL_MAX = 254;
export const CHECKOUT_NOTE_MAX = 500;

export const CHECKOUT_FIELDS = ['customerName', 'phone', 'address', 'city', 'email', 'note'] as const;
export type CheckoutField = (typeof CHECKOUT_FIELDS)[number];

const PHONE_MESSAGE = 'Enter a valid mobile number, for example 0300 1234567';
const EMAIL_MESSAGE = 'Enter a valid email address, or leave this empty';

/** Lengths are bounded by the schema, so this cannot be made slow by a long input. */
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;

/** One line of plain text: control characters become spaces, runs of space become one. Nothing else is touched. */
function singleLine(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Plain text that may keep its line breaks. */
function multiLine(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
    .trim();
}

function requiredLine(min: number, max: number, requiredMessage: string, tooLongMessage: string) {
  return z
    .string({ error: requiredMessage })
    .transform(singleLine)
    .pipe(z.string().min(min, requiredMessage).max(max, tooLongMessage));
}

/**
 * The customer's details at checkout, used as is by the form, the BFF and the seller backend. The output is what gets
 * stored: the phone in its one form and text cleaned of control characters. Text is plain text, kept exactly as typed:
 * "<b>" is five characters, not markup, and every place that shows it escapes it. Messages are written for shoppers.
 */
export const storefrontCheckoutCustomerSchema = z.object({
  customerName: requiredLine(CHECKOUT_NAME_MIN, CHECKOUT_NAME_MAX, 'Enter your full name', 'Name is too long'),
  phone: z.string({ error: PHONE_MESSAGE }).transform((value, context) => {
    const phone = value.length <= CHECKOUT_PHONE_INPUT_MAX ? normalizePhoneE164(value) : null;
    if (phone === null) {
      context.addIssue({ code: 'custom', message: PHONE_MESSAGE });
      return z.NEVER;
    }
    return phone;
  }),
  address: requiredLine(CHECKOUT_ADDRESS_MIN, CHECKOUT_ADDRESS_MAX, 'Enter your full delivery address', 'Address is too long'),
  city: requiredLine(CHECKOUT_CITY_MIN, CHECKOUT_CITY_MAX, 'Enter your city', 'City name is too long'),
  /** Optional. An empty box is no email. */
  email: z
    .string({ error: EMAIL_MESSAGE })
    .trim()
    .max(CHECKOUT_EMAIL_MAX, EMAIL_MESSAGE)
    .refine((value) => value === '' || EMAIL.test(value), EMAIL_MESSAGE)
    .transform((value) => (value === '' ? null : value.toLowerCase()))
    .nullish()
    .transform((value) => value ?? null),
  /** Optional. The shopper's own note to the seller, not the seller's internal order notes. */
  note: z
    .string({ error: 'Enter your note as text' })
    .transform(multiLine)
    .pipe(z.string().max(CHECKOUT_NOTE_MAX, 'Note is too long'))
    .transform((value) => (value === '' ? null : value))
    .nullish()
    .transform((value) => value ?? null),
});

export type CheckoutCustomerInput = z.input<typeof storefrontCheckoutCustomerSchema>;
export type CheckoutCustomer = z.output<typeof storefrontCheckoutCustomerSchema>;

/* ------------------------------------------- cart lines ------------------------------------------- */

export const STOREFRONT_ORDER_MAX_LINES = 50;
export const STOREFRONT_ORDER_MAX_QTY = 99;

/**
 * One cart line. qty is only checked as a number here: the range and integer rules live in the handler so a bad
 * quantity is reported as INVALID_QUANTITY with the offending productId. Unknown keys are stripped, so a browser that
 * sends a price or a total is ignored rather than trusted.
 */
export const storefrontOrderLineRequestSchema = z.object({
  productId: z.string().trim().min(1).max(64),
  /** May be left out only for a product with exactly one variant. Otherwise the answer is 422 VARIANT_REQUIRED. */
  variantId: z.string().trim().min(1).max(64).optional(),
  qty: z.number(),
});

/* ------------------------------------------- quote ------------------------------------------- */

/** Shoppers only ever see whole rupees (D-004). */
const rupees = z.number().int().nonnegative();
const text = z.string().nullable();

/** The cart quote request: product ids and quantities only. The answer is priced by the server. */
export const storefrontCartQuoteRequestSchema = z.object({
  lines: z.array(storefrontOrderLineRequestSchema).max(STOREFRONT_ORDER_MAX_LINES),
});

export const STOREFRONT_CART_QUOTE_ISSUES = [
  'unknown_product',
  'product_unavailable',
  'unknown_variant',
  'out_of_stock',
  'insufficient_stock',
] as const;
export type StorefrontCartQuoteIssue = (typeof STOREFRONT_CART_QUOTE_ISSUES)[number];

export const storefrontCartQuoteIssueSchema = z.enum(STOREFRONT_CART_QUOTE_ISSUES);

export const storefrontCartQuoteLineSchema = z.object({
  productId: z.string().min(1),
  /** Null when the variant could not be resolved. */
  variantId: text,
  /** Null when the product is unknown to this store or not for sale. */
  title: text,
  variantTitle: text,
  unitPrice: rupees.nullable(),
  qty: z.number().int().min(1),
  /** Null for a line that cannot be bought. */
  lineTotal: rupees.nullable(),
  issue: storefrontCartQuoteIssueSchema.nullable(),
  /** Units that can still be bought, when the server knows them. */
  availableQty: z.number().int().nonnegative().nullable(),
});

/**
 * The money of a cart or an order, computed by the server only. The quote and the order service both produce this
 * shape from the same function, so the total a shopper sees is the total they are charged.
 */
export const storefrontQuoteTotalsSchema = z.object({
  subtotal: rupees,
  deliveryCharges: rupees,
  /** Always 0 until discount codes arrive (D-080). Defaulted so a storefront deployed before the backend can still read a quote. */
  discount: rupees.default(0),
  total: rupees,
});

export const storefrontCartQuoteSchema = storefrontQuoteTotalsSchema.extend({
  /** Lines that cannot be bought carry an issue and are left out of the totals. */
  lines: z.array(storefrontCartQuoteLineSchema),
  /** True when there is at least one line and every line can be bought. */
  canCheckout: z.boolean(),
});

export const storefrontCartQuoteResponseSchema = z.object({ data: storefrontCartQuoteSchema });

export type StorefrontQuoteTotals = z.output<typeof storefrontQuoteTotalsSchema>;
export type StorefrontCartQuoteLine = z.output<typeof storefrontCartQuoteLineSchema>;
export type StorefrontCartQuoteDto = z.output<typeof storefrontCartQuoteSchema>;
