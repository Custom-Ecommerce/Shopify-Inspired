import { z } from 'zod';

/*
 * Sprint 8 (S8-B1, D-118): store tax. Simple on purpose. PKR only, OFF by default, ONE rate per store, whole rupees.
 *
 *   exclusive  the prices are before tax: the tax is ADDED to the order
 *   inclusive  the prices already contain the tax: it is EXTRACTED from them and shown; the total does not change
 *
 * The tax applies to (item subtotal - discount). Delivery is NOT taxed. ONE rounding rule: round half up, applied ONCE to the whole tax amount of
 * the order, never per line. The commission base (item subtotal - discount) never includes tax (D-089). An order written before this existed has no
 * tax fields and reads as tax 0. Everything here is pure integer arithmetic (the rate is held in hundredths of a percent).
 */

export const TAX_MODES = ['exclusive', 'inclusive'] as const;
export type TaxMode = (typeof TAX_MODES)[number];

export const TAX_LABEL_DEFAULT = 'Tax';
export const TAX_LABEL_MAX = 20;
export const TAX_RATE_MAX = 100;

export interface TaxSettings {
  enabled: boolean;
  /** 0 to 100, at most 2 decimals. */
  ratePercent: number;
  mode: TaxMode;
  label: string;
}

export const DEFAULT_TAX_SETTINGS: TaxSettings = { enabled: false, ratePercent: 0, mode: 'exclusive', label: TAX_LABEL_DEFAULT };

/** A rate as hundredths of a percent (17.5 -> 1750), or null when it is not a number from 0 to 100 with at most 2 decimals. */
export function rateInHundredths(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > TAX_RATE_MAX) return null;
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  return Math.abs(scaled - rounded) < 1e-6 ? rounded : null;
}

export const isValidTaxRate = (value: unknown): value is number => rateInHundredths(value) !== null;

/** Round half up of numerator / denominator, in exact integer arithmetic (both positive, below 2^53). */
function divideHalfUp(numerator: number, denominator: number): number {
  const twice = 2 * numerator + denominator;
  const step = 2 * denominator;
  return (twice - (twice % step)) / step;
}

export interface TaxRule {
  enabled: boolean;
  ratePercent: number;
  mode: TaxMode;
}

/**
 * The tax of an order, in whole rupees. `taxable` is the item subtotal after the discount (delivery is never part of it).
 *   exclusive: round(taxable x rate / 100)
 *   inclusive: round(taxable x rate / (100 + rate))   (the tax already inside the price)
 * 0 when tax is off, the rate is not valid, or nothing is taxable.
 */
export function taxAmountOf(taxable: number, rule: TaxRule | null | undefined): number {
  if (!rule || rule.enabled !== true) return 0;
  const rate = rateInHundredths(rule.ratePercent);
  const base = typeof taxable === 'number' && Number.isFinite(taxable) ? Math.round(taxable) : 0;
  if (rate === null || rate === 0 || base <= 0) return 0;
  return rule.mode === 'inclusive' ? divideHalfUp(base * rate, 10000 + rate) : divideHalfUp(base * rate, 10000);
}

/** What an order stores about its tax (a snapshot, so a later change of the store's tax never rewrites it). Absent fields read as no tax. */
export interface OrderTaxSnapshot {
  taxAmount: number;
  taxMode: TaxMode | null;
  taxRatePercent: number;
}

const whole = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);

/** Reads the tax of an order row: an old order (no fields) is tax 0 and mode null. */
export function readOrderTax(row: { taxAmount?: unknown; taxMode?: unknown; taxRatePercent?: unknown } | null | undefined): OrderTaxSnapshot {
  const amount = whole(row?.taxAmount);
  const mode = row?.taxMode === 'inclusive' || row?.taxMode === 'exclusive' ? row.taxMode : null;
  const rate = typeof row?.taxRatePercent === 'number' && rateInHundredths(row.taxRatePercent) !== null ? row.taxRatePercent : 0;
  return amount > 0 && mode !== null ? { taxAmount: amount, taxMode: mode, taxRatePercent: rate } : { taxAmount: 0, taxMode: null, taxRatePercent: 0 };
}

// ---------------------------------------------------------------------------------------------------------- the settings group

const NO_HTML = /[<>]/;

/** The label shown next to the amount: plain text on one line, 1 to 20 characters, no < or >. */
const labelSchema = z
  .string({ error: 'the tax name must be text' })
  .transform((value) => value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(1, 'the tax name cannot be empty')
      .max(TAX_LABEL_MAX, 'the tax name can be at most ' + TAX_LABEL_MAX + ' characters')
      .refine((value) => !NO_HTML.test(value), 'the tax name cannot contain < or >'),
  );

const rateSchema = z
  .number({ error: 'the tax rate must be a number' })
  .refine((value) => Number.isFinite(value) && value >= 0, 'the tax rate cannot be negative')
  .refine((value) => !Number.isFinite(value) || value <= TAX_RATE_MAX, 'the tax rate can be at most ' + TAX_RATE_MAX + '%')
  .refine((value) => !Number.isFinite(value) || value < 0 || value > TAX_RATE_MAX || rateInHundredths(value) !== null, 'the tax rate can have at most 2 decimals');

export const taxFields = {
  enabled: z.boolean({ error: 'enabled must be true or false' }),
  ratePercent: rateSchema,
  mode: z.enum(TAX_MODES, { error: 'choose exclusive or inclusive' }),
  label: labelSchema,
} as const;

export type TaxKey = keyof typeof taxFields;
export const TAX_KEYS = Object.keys(taxFields) as TaxKey[];

/** The settings group 'tax' of PATCH /api/stores/:id. Every field optional (a change names only what it changes); strict, so an unknown key is a 400. */
export const storeTaxUpdateSchema = z.object(taxFields).partial().strict();
export type StoreTaxUpdate = z.output<typeof storeTaxUpdateSchema>;

/** The tax settings as the screen reads them (defaults filled in). */
export const storeTaxReadSchema = z.object({
  enabled: z.boolean(),
  ratePercent: z.number(),
  mode: z.enum(TAX_MODES),
  label: z.string(),
});

export const TAX_RATE_REQUIRED_MESSAGE = 'Enter the tax rate to turn tax on.';

/**
 * The tax settings of a store from what is stored, with the defaults filled in. A stored value that does not pass its own rule reads as the default
 * for that field; tax that is on without a usable rate reads as OFF (an order is never taxed by a broken setting).
 */
export function resolveTaxSettings(stored: unknown): TaxSettings {
  const raw = typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const rate = isValidTaxRate(raw.ratePercent) ? raw.ratePercent : null;
  const mode = raw.mode === 'inclusive' || raw.mode === 'exclusive' ? raw.mode : DEFAULT_TAX_SETTINGS.mode;
  const parsedLabel = labelSchema.safeParse(raw.label);
  return {
    enabled: raw.enabled === true && rate !== null,
    ratePercent: rate ?? 0,
    mode,
    label: parsedLabel.success ? parsedLabel.data : TAX_LABEL_DEFAULT,
  };
}

/** What the shopper sees as the name of the tax line: "Tax (included)" style for an inclusive store, the plain label for an exclusive one. */
export function taxLineLabel(label: string | null | undefined, mode: TaxMode | null | undefined): string {
  const name = typeof label === 'string' && label.trim() !== '' ? label.trim() : TAX_LABEL_DEFAULT;
  return mode === 'inclusive' ? name + ' (included)' : name;
}
