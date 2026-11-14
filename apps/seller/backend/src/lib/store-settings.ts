import * as themesNs from '@markaz/platform-kit/themes';
import type { StoreSettings, StoreSettingsUpdate } from '@markaz/contracts';
import { unwrapCjs } from '@/lib/cjs';
import { cityKey, maskAccountNumber, matchPakistanCity } from '@/lib/contracts';
import { HttpError } from '@/lib/http';
import { Media } from '@/lib/services';
import { cardPaymentsAvailable } from '@/lib/storefront/card-config';

const themes: typeof themesNs = unwrapCjs(themesNs);

/*
 * Sprint 4 EP-04 (D-094, D-088): how the store settings live in the Store document, read and written in one place.
 *
 * The settings stay where the storefront already reads them, so nothing is migrated: storefront (Mixed) holds the
 * profile, branding, SEO, social, delivery and theme keys; paymentSettings (Mixed) holds codEnabled and cardEnabled;
 * payoutDetails (Mixed, never selected by default) holds the payout account. A key that is missing reads as today's
 * behaviour: delivery 0 with no free offer, COD on, card on whenever the platform keys exist, the default theme.
 */

export const SETTINGS_ERROR_CODE = 'STORE_SETTINGS_INVALID';

export interface StoreDoc {
  _id: unknown;
  slug?: unknown;
  name?: unknown;
  status?: unknown;
  owner?: unknown;
  storefront?: unknown;
  paymentSettings?: unknown;
  payoutDetails?: unknown;
  updatedAt?: unknown;
}

export function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);

/** Whole rupees (D-004); anything else is "not set". */
export function amount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

const iso = (value: unknown): string | null => (value instanceof Date ? value.toISOString() : typeof value === 'string' && value !== '' ? value : null);

// ---------------------------------------------------------------------------------------------------------- delivery

export interface DeliverySettings {
  defaultRate: number;
  freeOver: number | null;
  cityRates: Array<{ city: string; rate: number }>;
  estimate: string | null;
}

export function readDelivery(storefront: unknown): DeliverySettings {
  const sf = record(storefront);
  const free = amount(sf.freeDeliveryThreshold);
  const rows = Array.isArray(sf.deliveryCityRates) ? (sf.deliveryCityRates as unknown[]) : [];
  const cityRates: Array<{ city: string; rate: number }> = [];
  for (const row of rows) {
    const entry = record(row);
    const city = matchPakistanCity(entry.city);
    const rate = amount(entry.rate);
    if (city !== null && rate !== null && !cityRates.some((c) => c.city === city)) cityRates.push({ city, rate });
  }
  return { defaultRate: amount(sf.deliveryRate) ?? 0, freeOver: free !== null && free > 0 ? free : null, cityRates, estimate: text(sf.deliveryEstimate) };
}

/** The rate per city key, for pricing: a shopper's free-text city is matched with cityKey(). */
export function cityRateMap(delivery: DeliverySettings): Record<string, number> {
  const map: Record<string, number> = {};
  for (const row of delivery.cityRates) map[cityKey(row.city)] = row.rate;
  return map;
}

// ---------------------------------------------------------------------------------------------------------- payments

export function readPayments(paymentSettings: unknown): { codEnabled: boolean; cardEnabled: boolean } {
  const pay = record(paymentSettings);
  // A missing switch keeps today's behaviour: COD on, card on (offered only with the platform keys, A-015).
  return { codEnabled: pay.codEnabled !== false, cardEnabled: pay.cardEnabled !== false };
}

// ------------------------------------------------------------------------------------------------------------ payout

export interface StoredPayout {
  method: 'bank' | 'jazzcash' | 'easypaisa';
  accountTitle: string;
  accountNumber: string;
  bankName: string | null;
  updatedAt?: Date | string | null;
}

export function readPayout(payoutDetails: unknown): StoredPayout | null {
  const payout = record(payoutDetails);
  const method = payout.method;
  if ((method !== 'bank' && method !== 'jazzcash' && method !== 'easypaisa') || !text(payout.accountNumber) || !text(payout.accountTitle)) return null;
  return {
    method,
    accountTitle: String(payout.accountTitle),
    accountNumber: String(payout.accountNumber),
    bankName: text(payout.bankName),
    updatedAt: (payout.updatedAt as Date | string | null | undefined) ?? null,
  };
}

/** What leaves the server: never the full account number (D-088). */
export function maskPayout(payoutDetails: unknown): StoreSettings['payout'] {
  const payout = readPayout(payoutDetails);
  if (!payout) return null;
  return {
    method: payout.method,
    accountTitle: payout.accountTitle,
    accountNumberMasked: maskAccountNumber(payout.accountNumber),
    bankName: payout.bankName,
    updatedAt: iso(payout.updatedAt),
  };
}

// ------------------------------------------------------------------------------------------------------------- theme

export function installedThemeSlugs(): string[] {
  return themes.listInstalledThemes().map((entry) => entry.slug);
}

/** The theme a store renders with: its own if it is installed, else the platform default (as the storefront does). */
export function effectiveTheme(storefront: unknown): string {
  const chosen = text(record(storefront).activeTheme);
  return chosen !== null && themes.isInstalledThemeSlug(chosen) ? chosen : themes.DEFAULT_THEME_SLUG;
}

// -------------------------------------------------------------------------------------------------- the settings DTO

async function mediaOf(ref: unknown, storeId: string): Promise<{ id: string; url: string | null } | null> {
  if (ref === null || ref === undefined || ref === '') return null;
  const id = typeof ref === 'object' && ref !== null && '_id' in (ref as object) ? String((ref as { _id: unknown })._id) : String(ref);
  if (!/^[0-9a-fA-F]{24}$/.test(id)) return null;
  const row = (await Media.findOne({ _id: id, store: storeId }).select('url').lean()) as { url?: unknown } | null;
  return { id, url: row ? text(row.url) : null };
}

/** The settings screen's view of a store (GET .../settings and the PATCH answer). payoutDetails must have been selected. */
export async function toStoreSettings(doc: StoreDoc): Promise<StoreSettings> {
  const storeId = String(doc._id);
  const sf = record(doc.storefront);
  const social = record(sf.social);
  const [logo, banner, seoImage] = await Promise.all([mediaOf(sf.logo, storeId), mediaOf(sf.banner, storeId), mediaOf(sf.seoImage, storeId)]);
  return {
    id: storeId,
    slug: String(doc.slug ?? ''),
    status: String(doc.status ?? 'pending'),
    profile: {
      name: String(doc.name ?? ''),
      description: text(sf.description),
      contactPhone: text(sf.contactPhone),
      whatsappNumber: text(sf.whatsappNumber),
      contactEmail: text(sf.contactEmail),
      address: text(sf.address),
      city: text(sf.city),
    },
    branding: { logo, banner },
    social: { facebook: text(social.facebook), instagram: text(social.instagram), tiktok: text(social.tiktok), whatsapp: text(social.whatsapp) },
    seo: { title: text(sf.seoTitle), description: text(sf.seoDescription), image: seoImage },
    delivery: readDelivery(sf),
    payments: { ...readPayments(doc.paymentSettings), cardAvailable: cardPaymentsAvailable() },
    payout: maskPayout(doc.payoutDetails),
    theme: { activeTheme: effectiveTheme(sf) },
    updatedAt: iso(doc.updatedAt),
  };
}

// ------------------------------------------------------------------------------------------------------------ writing

const invalid = (field: string, message: string): HttpError => new HttpError(400, message, SETTINGS_ERROR_CODE, field);

export interface SettingsWrite {
  /** The top-level fields written, for the policy check and the audit entry. */
  fields: string[];
  set: Record<string, unknown>;
  groups: string[];
  payoutChanged: boolean;
  payoutSummary: { method: string; last4: string } | null;
}

/** The top-level Store fields an update writes, known before the store is read (for the policy check). */
export function settingsFieldsOf(update: StoreSettingsUpdate): string[] {
  const fields = new Set<string>();
  if (update.profile?.name !== undefined) fields.add('name');
  const profileRest = update.profile ? Object.keys(update.profile).filter((key) => key !== 'name') : [];
  if (profileRest.length > 0 || update.branding || update.social || update.seo || update.delivery || update.theme) fields.add('storefront');
  if (update.payments) fields.add('paymentSettings');
  if (update.payout !== undefined) fields.add('payoutDetails');
  return [...fields];
}

/** The media ids the update names, with the field each is for (the route checks they are this store's). */
export function referencedMedia(update: StoreSettingsUpdate): Array<{ field: string; id: string }> {
  const refs: Array<{ field: string; id: string }> = [];
  if (update.branding?.logo) refs.push({ field: 'branding.logo', id: update.branding.logo });
  if (update.branding?.banner) refs.push({ field: 'branding.banner', id: update.branding.banner });
  if (update.seo?.image) refs.push({ field: 'seo.image', id: update.seo.image });
  return refs;
}

/**
 * Merges an update into the stored settings and checks the rules that need both: at least one payment method stays on,
 * and the theme is an installed one. The whole storefront and paymentSettings objects are written (one $set), so a store
 * whose Mixed field is missing or null is handled the same as any other. Throws 400 STORE_SETTINGS_INVALID naming the field.
 */
export function buildSettingsWrite(doc: StoreDoc, update: StoreSettingsUpdate, now: Date = new Date()): SettingsWrite {
  const sf = { ...record(doc.storefront) };
  const pay = { ...record(doc.paymentSettings) };
  const set: Record<string, unknown> = {};
  const fields = new Set<string>();
  const groups = Object.keys(update);
  let storefrontChanged = false;
  const put = (key: string, value: unknown): void => {
    sf[key] = value;
    storefrontChanged = true;
  };

  if (update.profile) {
    const p = update.profile;
    if (p.name !== undefined) {
      set.name = p.name;
      fields.add('name');
    }
    if (p.description !== undefined) put('description', p.description);
    if (p.contactPhone !== undefined) put('contactPhone', p.contactPhone);
    if (p.whatsappNumber !== undefined) put('whatsappNumber', p.whatsappNumber);
    if (p.contactEmail !== undefined) put('contactEmail', p.contactEmail);
    if (p.address !== undefined) put('address', p.address);
    if (p.city !== undefined) put('city', p.city);
  }
  if (update.branding) {
    if (update.branding.logo !== undefined) put('logo', update.branding.logo);
    if (update.branding.banner !== undefined) put('banner', update.branding.banner);
  }
  if (update.social) put('social', { ...record(sf.social), ...update.social });
  if (update.seo) {
    if (update.seo.title !== undefined) put('seoTitle', update.seo.title);
    if (update.seo.description !== undefined) put('seoDescription', update.seo.description);
    if (update.seo.image !== undefined) put('seoImage', update.seo.image);
  }
  if (update.delivery) {
    const d = update.delivery;
    if (d.defaultRate !== undefined) put('deliveryRate', d.defaultRate);
    if (d.freeOver !== undefined) put('freeDeliveryThreshold', d.freeOver);
    if (d.cityRates !== undefined) put('deliveryCityRates', d.cityRates);
    if (d.estimate !== undefined) put('deliveryEstimate', d.estimate);
  }
  if (update.theme) {
    if (!installedThemeSlugs().includes(update.theme.activeTheme)) throw invalid('theme.activeTheme', 'Choose a theme from the list.');
    put('activeTheme', update.theme.activeTheme);
  }
  if (storefrontChanged) {
    set.storefront = sf;
    fields.add('storefront');
  }

  if (update.payments) {
    if (update.payments.codEnabled !== undefined) pay.codEnabled = update.payments.codEnabled;
    if (update.payments.cardEnabled !== undefined) pay.cardEnabled = update.payments.cardEnabled;
    const after = readPayments(pay);
    if (!after.codEnabled && !after.cardEnabled) {
      throw invalid(update.payments.codEnabled === false ? 'payments.codEnabled' : 'payments.cardEnabled', 'Keep at least one payment method on.');
    }
    set.paymentSettings = pay;
    fields.add('paymentSettings');
  }

  let payoutChanged = false;
  let payoutSummary: SettingsWrite['payoutSummary'] = null;
  if (update.payout !== undefined) {
    payoutChanged = true;
    set.payoutDetails = update.payout === null ? null : { ...update.payout, updatedAt: now };
    fields.add('payoutDetails');
    if (update.payout !== null) payoutSummary = { method: update.payout.method, last4: maskAccountNumber(update.payout.accountNumber).slice(-4) };
  }

  return { fields: [...fields], set, groups, payoutChanged, payoutSummary };
}
