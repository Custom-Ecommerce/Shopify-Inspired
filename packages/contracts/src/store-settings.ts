import { z } from 'zod';
import { normalizePhoneE164 } from './checkout';

/*
 * Sprint 4 EP-04 (D-094, D-088): the store settings a seller saves with ONE PATCH /api/stores/:id, the shape the
 * settings screen reads back, the readiness checklist and go-live. Amounts are whole rupees. Text is plain: no HTML.
 * The slug is not here on purpose: it cannot change after creation (the update schema is strict, so a sent slug is a
 * 400 that names the field).
 */

// ------------------------------------------------------------------------------------------------- shared city list

/**
 * The shared Pakistan city list (the delivery overrides are keyed by it). The checkout city is free text, so a shopper's
 * city is matched to an entry with cityKey(): case, spaces and dots do not matter.
 */
export const PAKISTAN_CITIES = [
  'Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Quetta', 'Hyderabad', 'Gujranwala',
  'Sialkot', 'Sargodha', 'Bahawalpur', 'Sukkur', 'Larkana', 'Sheikhupura', 'Rahim Yar Khan', 'Jhang', 'Dera Ghazi Khan', 'Gujrat',
  'Sahiwal', 'Wah Cantt', 'Mardan', 'Kasur', 'Okara', 'Mingora', 'Nawabshah', 'Chiniot', 'Kotri', 'Kamoke',
  'Hafizabad', 'Sadiqabad', 'Mirpur Khas', 'Burewala', 'Kohat', 'Khanewal', 'Dera Ismail Khan', 'Turbat', 'Muzaffargarh', 'Abbottabad',
  'Mandi Bahauddin', 'Shikarpur', 'Jacobabad', 'Jhelum', 'Khanpur', 'Khairpur', 'Khuzdar', 'Pakpattan', 'Hub', 'Daska',
  'Gojra', 'Muridke', 'Bahawalnagar', 'Samundri', 'Tando Allahyar', 'Tando Adam', 'Jaranwala', 'Chishtian', 'Muzaffarabad', 'Attock',
  'Vehari', 'Kot Abdul Malik', 'Ferozwala', 'Chakwal', 'Gujranwala Cantonment', 'Kamalia', 'Umerkot', 'Ahmedpur East', 'Kot Addu', 'Wazirabad',
  'Mansehra', 'Layyah', 'Mirpur', 'Swabi', 'Chaman', 'Taxila', 'Nowshera', 'Khushab', 'Shahdadkot', 'Mianwali',
  'Gilgit', 'Skardu', 'Gwadar', 'Charsadda', 'Haripur', 'Bannu', 'Murree', 'Thatta', 'Badin', 'Ghotki',
] as const;
export type PakistanCity = (typeof PAKISTAN_CITIES)[number];

/** The form a city is compared in: lower case, single spaces, no dots. */
export function cityKey(value: string): string {
  return value.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

const CITY_BY_KEY: ReadonlyMap<string, PakistanCity> = new Map(PAKISTAN_CITIES.map((city) => [cityKey(city), city]));

/** The list entry a typed city matches, or null. */
export function matchPakistanCity(value: unknown): PakistanCity | null {
  return typeof value === 'string' ? (CITY_BY_KEY.get(cityKey(value)) ?? null) : null;
}

// ------------------------------------------------------------------------------------------------------- building blocks

const NO_HTML = /[<>]/;

/** One line of plain text: controls become spaces, runs of space one space; < and > (HTML) are refused. */
function plainLine(max: number, label: string) {
  return z
    .string()
    .transform((value) => value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(max, label + ' can be at most ' + max + ' characters').refine((value) => !NO_HTML.test(value), label + ' cannot contain < or >'));
}

/** Several lines of plain text (a description): line breaks kept, other controls removed, no HTML. */
function plainText(max: number, label: string) {
  return z
    .string()
    .transform((value) => value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').trim())
    .pipe(z.string().max(max, label + ' can be at most ' + max + ' characters').refine((value) => !NO_HTML.test(value), label + ' cannot contain < or >'));
}

/** Optional text: an empty string clears it (null). */
const clearable = <T extends z.ZodType<string>>(schema: T) => z.union([z.literal(''), z.null(), schema]).transform((value) => (value === '' || value === null ? null : (value as string)));

const PHONE_MESSAGE = 'Enter a valid mobile number, for example 0300 1234567';

/** The shared Pakistani mobile rule, stored as +923xxxxxxxxx; empty clears it. */
const phoneSchema = z
  .union([z.literal(''), z.null(), z.string().max(32)])
  .transform((value, context) => {
    if (value === '' || value === null) return null;
    const phone = normalizePhoneE164(value);
    if (phone === null) {
      context.addIssue({ code: 'custom', message: PHONE_MESSAGE });
      return z.NEVER;
    }
    return phone;
  });

const emailSchema = clearable(z.string().trim().toLowerCase().max(254).email('Enter a valid email address'));

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
/** A reference to one of the store's own Media records (the upload routes create them); null removes it. */
const mediaRefSchema = z.union([z.null(), z.string().regex(OBJECT_ID, 'must be a media id')]);

/** A link on a known social site, https only. */
function socialUrl(hosts: readonly string[], label: string) {
  return clearable(
    z
      .string()
      .trim()
      .max(300, label + ' link is too long')
      .url(label + ' must be a full link starting with https://')
      .refine((value) => {
        try {
          const url = new URL(value);
          const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
          return url.protocol === 'https:' && hosts.some((allowed) => host === allowed || host.endsWith('.' + allowed));
        } catch {
          return false;
        }
      }, label + ' must be an https link on ' + hosts.join(' or ')),
  );
}

/** Whole rupees, 0 to 100,000. */
const rupees = (label: string) =>
  z.number({ error: label + ' must be a number' }).int(label + ' must be whole rupees').min(0, label + ' cannot be negative').max(100_000, label + ' is too large');

// ------------------------------------------------------------------------------------------------------- the PATCH body

export const STORE_NAME_MAX = 80;
export const STORE_DESCRIPTION_MAX = 1000;
export const STORE_SEO_TITLE_MAX = 70;
export const STORE_SEO_DESCRIPTION_MAX = 160;
export const STORE_DELIVERY_ESTIMATE_MAX = 60;
export const STORE_CITY_RATES_MAX = 100;

export const storeProfileUpdateSchema = z
  .object({
    name: plainLine(STORE_NAME_MAX, 'name').pipe(z.string().min(2, 'name must be at least 2 characters')),
    description: clearable(plainText(STORE_DESCRIPTION_MAX, 'description')),
    contactPhone: phoneSchema,
    whatsappNumber: phoneSchema,
    contactEmail: emailSchema,
    address: clearable(plainLine(300, 'address')),
    city: clearable(plainLine(60, 'city')),
  })
  .partial()
  .strict();

export const storeBrandingUpdateSchema = z.object({ logo: mediaRefSchema, banner: mediaRefSchema }).partial().strict();

export const storeSocialUpdateSchema = z
  .object({
    facebook: socialUrl(['facebook.com', 'fb.com'], 'Facebook'),
    instagram: socialUrl(['instagram.com'], 'Instagram'),
    tiktok: socialUrl(['tiktok.com'], 'TikTok'),
    whatsapp: socialUrl(['wa.me', 'whatsapp.com'], 'WhatsApp'),
  })
  .partial()
  .strict();

export const storeSeoUpdateSchema = z
  .object({
    title: clearable(plainLine(STORE_SEO_TITLE_MAX, 'SEO title')),
    description: clearable(plainLine(STORE_SEO_DESCRIPTION_MAX, 'SEO description')),
    image: mediaRefSchema,
  })
  .partial()
  .strict();

export const deliveryCityRateSchema = z
  .object({
    city: z.string().refine((value) => matchPakistanCity(value) !== null, 'choose a city from the list').transform((value) => matchPakistanCity(value) as PakistanCity),
    rate: rupees('the city rate'),
  })
  .strict();

export const storeDeliveryUpdateSchema = z
  .object({
    defaultRate: rupees('the delivery rate'),
    /** Delivery is free when the item subtotal AFTER discount reaches this. null: no free-delivery offer. */
    freeOver: z.union([z.null(), rupees('the free-delivery amount')]),
    cityRates: z
      .array(deliveryCityRateSchema)
      .max(STORE_CITY_RATES_MAX, 'at most ' + STORE_CITY_RATES_MAX + ' cities')
      .refine((rows) => new Set(rows.map((row) => row.city)).size === rows.length, 'each city can have one rate'),
    estimate: clearable(plainLine(STORE_DELIVERY_ESTIMATE_MAX, 'the delivery estimate')),
  })
  .partial()
  .strict();

export const storePaymentsUpdateSchema = z.object({ codEnabled: z.boolean(), cardEnabled: z.boolean() }).partial().strict();

export const PAYOUT_METHODS = ['bank', 'jazzcash', 'easypaisa'] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

/** D-088: where the platform pays the seller. Bank needs a bank name and an IBAN or account number; wallets a mobile number. */
export const payoutDetailsSchema = z
  .object({
    method: z.enum(PAYOUT_METHODS, { error: 'choose bank, jazzcash or easypaisa' }),
    accountTitle: plainLine(100, 'account title').pipe(z.string().min(2, 'account title is required')),
    accountNumber: z
      .string()
      .transform((value) => value.replace(/[\s-]/g, '').toUpperCase())
      .pipe(z.string().regex(/^[A-Z0-9]{8,34}$/, 'account number or IBAN must be 8 to 34 letters and digits')),
    bankName: clearable(plainLine(80, 'bank name')),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.method === 'bank' && value.bankName === null) context.addIssue({ code: 'custom', path: ['bankName'], message: 'bank name is required for a bank transfer' });
    if (value.method !== 'bank' && !/^(03\d{9}|923\d{9})$/.test(value.accountNumber)) {
      context.addIssue({ code: 'custom', path: ['accountNumber'], message: 'a ' + value.method + ' account is the 11-digit mobile number, for example 03001234567' });
    }
  });
export type PayoutDetails = z.output<typeof payoutDetailsSchema>;

export const storeThemeUpdateSchema = z.object({ activeTheme: z.string().regex(/^[a-z0-9-]{2,40}$/, 'choose a theme from the list') }).strict();

/**
 * PATCH /api/stores/:id. Every group is optional and so is every field in it; at least one must be sent. payout null
 * removes the payout details.
 */
export const storeSettingsUpdateSchema = z
  .object({
    profile: storeProfileUpdateSchema,
    branding: storeBrandingUpdateSchema,
    social: storeSocialUpdateSchema,
    seo: storeSeoUpdateSchema,
    delivery: storeDeliveryUpdateSchema,
    payments: storePaymentsUpdateSchema,
    // nullable, not a union: a union would report a bad account number as "payout" instead of "payout.accountNumber".
    payout: payoutDetailsSchema.nullable(),
    theme: storeThemeUpdateSchema,
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'change at least one setting' });
export type StoreSettingsUpdate = z.output<typeof storeSettingsUpdateSchema>;

// --------------------------------------------------------------------------------------------- what the screen reads

/** Only the last 4 characters of an account number ever leave the server. */
export function maskAccountNumber(value: string): string {
  const clean = value.replace(/\s/g, '');
  return clean.length <= 4 ? '••••' : '••••' + clean.slice(-4);
}

const mediaSchema = z.object({ id: z.string(), url: z.string().nullable() }).nullable();

export const maskedPayoutSchema = z.object({
  method: z.enum(PAYOUT_METHODS),
  accountTitle: z.string(),
  accountNumberMasked: z.string(),
  bankName: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type MaskedPayout = z.output<typeof maskedPayoutSchema>;

export const storeSettingsSchema = z.object({
  id: z.string(),
  slug: z.string(),
  status: z.string(),
  profile: z.object({
    name: z.string(),
    description: z.string().nullable(),
    contactPhone: z.string().nullable(),
    whatsappNumber: z.string().nullable(),
    contactEmail: z.string().nullable(),
    address: z.string().nullable(),
    city: z.string().nullable(),
  }),
  branding: z.object({ logo: mediaSchema, banner: mediaSchema }),
  social: z.object({ facebook: z.string().nullable(), instagram: z.string().nullable(), tiktok: z.string().nullable(), whatsapp: z.string().nullable() }),
  seo: z.object({ title: z.string().nullable(), description: z.string().nullable(), image: mediaSchema }),
  delivery: z.object({
    defaultRate: z.number().int().min(0),
    freeOver: z.number().int().min(0).nullable(),
    cityRates: z.array(z.object({ city: z.string(), rate: z.number().int().min(0) })),
    estimate: z.string().nullable(),
  }),
  payments: z.object({
    codEnabled: z.boolean(),
    cardEnabled: z.boolean(),
    /** Card is only offered when the platform's Stripe keys are set too. */
    cardAvailable: z.boolean(),
  }),
  payout: maskedPayoutSchema.nullable(),
  theme: z.object({ activeTheme: z.string() }),
  updatedAt: z.string().nullable(),
});
export type StoreSettings = z.output<typeof storeSettingsSchema>;

// -------------------------------------------------------------------------------------------- readiness and go-live

/** The go-live checklist (D-094), in the order the dashboard shows it. tab names the settings tab that fixes it. */
export const STORE_READINESS_ITEMS = ['profile', 'delivery', 'payment', 'payout', 'product', 'email'] as const;
export type StoreReadinessItem = (typeof STORE_READINESS_ITEMS)[number];

export const storeReadinessSchema = z.object({
  ready: z.boolean(),
  status: z.string(),
  items: z.array(z.object({ key: z.enum(STORE_READINESS_ITEMS), ok: z.boolean(), label: z.string(), tab: z.string() })),
  missing: z.array(z.enum(STORE_READINESS_ITEMS)),
});
export type StoreReadiness = z.output<typeof storeReadinessSchema>;

export const storeGoLiveResponseSchema = z.object({
  status: z.enum(['active', 'pending']),
  /** True when the platform requires an admin to approve: the store stays pending until then. */
  waitingForApproval: z.boolean(),
  message: z.string(),
});
export type StoreGoLiveResponse = z.output<typeof storeGoLiveResponseSchema>;

export const themeListResponseSchema = z.object({
  themes: z.array(z.object({ slug: z.string(), name: z.string(), tier: z.string(), previewImage: z.string().nullable(), isDefaultForNewStores: z.boolean() })),
});
