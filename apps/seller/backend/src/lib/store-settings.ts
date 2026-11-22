import * as themesNs from '@markaz/platform-kit/themes';
import type { StoreSettings, StoreSettingsUpdate } from '@markaz/contracts';
import { unwrapCjs } from '@/lib/cjs';
import {
  CARD_CHECKOUT_UNSUPPORTED_BY_THEME,
  CARD_CHECKOUT_UNSUPPORTED_MESSAGE,
  CARD_CHECKOUT_UNSUPPORTED_THEME_MESSAGE,
  NO_USABLE_PAYMENT_METHOD,
  THEME_NOT_AVAILABLE,
  THEME_NOT_AVAILABLE_MESSAGE,
  RETURN_WINDOW_DAYS_DEFAULT,
  NO_USABLE_PAYMENT_METHOD_MESSAGE,
  cityKey,
  maskAccountNumber,
  matchPakistanCity,
} from '@/lib/contracts';
import { readFraud } from '@/lib/fraud';
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

// ---------------------------------------------------------------------------------------------------- message overrides

export interface MessageOverrides {
  whatsappTemplate: string | null;
  emailFooter: string | null;
}

/** EP-07.US02.T02: the seller's own WhatsApp text and email footer, both optional (null: the platform default). */
export function readMessages(storefront: unknown): MessageOverrides {
  const sf = record(storefront);
  return { whatsappTemplate: text(sf.whatsappTemplate), emailFooter: text(sf.emailFooter) };
}

/**
 * Sprint 5 EP-28.US01.T05 (D-107): whether the store wants the optional automatic email about a cart left behind. Kept in paymentSettings (like
 * the fraud settings: the public storefront never reads it), shown to the seller in the messages group. OFF unless it is exactly true.
 */
export function readAbandonedCartEmail(paymentSettings: unknown): boolean {
  return record(paymentSettings).abandonedCartEmail === true;
}

/**
 * SB-6 (verification bug 11): the moment the abandoned cart email switch last went from off to on, or null (a store that switched it on before
 * this field existed, which then has no lower bound). Only a cart left AFTER it is emailed: switching the email on never mails the carts that were
 * already waiting. Private like the switch itself: it is never part of the settings answer.
 */
export function readAbandonedCartEmailSince(paymentSettings: unknown): Date | null {
  const value = record(paymentSettings).abandonedCartEmailSince;
  const date = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
  return date !== null && !Number.isNaN(date.getTime()) ? date : null;
}

// ----------------------------------------------------------------------------------------------------------- returns

/**
 * Sprint 5 EP-13.US01.T02: how many days after delivery a shopper may ask for a return (0 = the store takes no returns, default 7). A
 * stored value that is not a whole number from 0 to 30 reads as the default. Kept in storefront next to the other shopper-facing policy.
 */
export function readReturnWindowDays(storefront: unknown): number {
  const value = record(storefront).returnWindowDays;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 30 ? value : (RETURN_WINDOW_DAYS_DEFAULT as number);
}

// ------------------------------------------------------------------------------------------------------------- theme

/** Sprint 7 (D-115): the themes a seller may choose (installed, available, not hidden): Stiletto only. */
export function sellerThemeSlugs(): string[] {
  return themes.listSellerThemes().map((entry) => entry.slug);
}

/** Whether a theme's checkout can take a card payment (the manifest flag; false when the theme has none). */
export function themeSupportsCardCheckout(slug: string): boolean {
  return themes.themeSupportsCardCheckout(slug);
}

/** The theme a store renders with: its own if a seller can choose it, else the platform default, Stiletto (as the storefront does, D-115). */
export function effectiveTheme(storefront: unknown): string {
  return themes.resolveRenderTheme(text(record(storefront).activeTheme)).slug;
}

/** The theme the store chose that it cannot render (mola, gani, mustafa ...), or null: the Theme tab shows a notice for it. */
export function unavailableTheme(storefront: unknown): string | null {
  return themes.resolveRenderTheme(text(record(storefront).activeTheme)).unavailableTheme;
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
    theme: { activeTheme: effectiveTheme(sf), supportsCardCheckout: themeSupportsCardCheckout(effectiveTheme(sf)), unavailableTheme: unavailableTheme(sf) },
    messages: { ...readMessages(sf), abandonedCartEmail: readAbandonedCartEmail(doc.paymentSettings) },
    // Sprint 5 EP-11: kept in paymentSettings (never in storefront, which the public storefront reads).
    fraud: readFraud(doc.paymentSettings),
    returns: { returnWindowDays: readReturnWindowDays(sf) },
    updatedAt: iso(doc.updatedAt),
  };
}

// ------------------------------------------------------------------------------------------------------------ writing

const invalid = (field: string, message: string): HttpError => new HttpError(400, message, SETTINGS_ERROR_CODE, field);
const cardUnsupported = (field: string, message: string): HttpError => new HttpError(422, message, CARD_CHECKOUT_UNSUPPORTED_BY_THEME, field);

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
  if (profileRest.length > 0 || update.branding || update.social || update.seo || update.delivery || update.theme || update.messages || update.returns) fields.add('storefront');
  if (update.payments || update.fraud || update.messages?.abandonedCartEmail !== undefined) fields.add('paymentSettings');
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
 * and the theme is an installed one; COD may not go off while card is unavailable (422 NO_USABLE_PAYMENT_METHOD, field payments). The whole storefront and paymentSettings objects are written (one $set), so a store
 * whose Mixed field is missing or null is handled the same as any other. Throws 400 STORE_SETTINGS_INVALID naming the field, or 422 CARD_CHECKOUT_UNSUPPORTED_BY_THEME when the store would be card only on a theme without card checkout (SB-11).
 */
export function buildSettingsWrite(doc: StoreDoc, update: StoreSettingsUpdate, now: Date = new Date()): SettingsWrite {
  const sf = { ...record(doc.storefront) };
  const pay = { ...record(doc.paymentSettings) };
  const before = readPayments(pay);
  const themeBefore = effectiveTheme(sf);
  const themeAfter = update.theme ? update.theme.activeTheme : themeBefore;
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
    if (!sellerThemeSlugs().includes(update.theme.activeTheme)) {
      // A theme the platform knows but a seller cannot choose (hidden, coming soon, archived) is a 422; a slug nobody has heard of is a 400.
      if (themes.isThemeSlug(update.theme.activeTheme)) throw new HttpError(422, THEME_NOT_AVAILABLE_MESSAGE, THEME_NOT_AVAILABLE, 'theme.activeTheme');
      throw invalid('theme.activeTheme', 'Choose a theme from the list.');
    }
    put('activeTheme', update.theme.activeTheme);
  }
  if (update.messages) {
    if (update.messages.whatsappTemplate !== undefined) put('whatsappTemplate', update.messages.whatsappTemplate);
    if (update.messages.emailFooter !== undefined) put('emailFooter', update.messages.emailFooter);
    // Sprint 5 EP-28: the switch is private (paymentSettings, never the public storefront object).
    if (update.messages.abandonedCartEmail !== undefined) {
      const wasOn = pay.abandonedCartEmail === true;
      pay.abandonedCartEmail = update.messages.abandonedCartEmail;
      // Set only on the transition off -> on (a save that repeats "on" keeps the moment), so carts left before it are never mailed.
      if (update.messages.abandonedCartEmail === true && !wasOn) pay.abandonedCartEmailSince = new Date();
      set.paymentSettings = pay;
      fields.add('paymentSettings');
    }
  }
  if (update.returns) {
    if (update.returns.returnWindowDays !== undefined) put('returnWindowDays', update.returns.returnWindowDays);
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
    // SB-11 (V-06): COD going off leaves the store card only; a theme whose checkout has no card option cannot take any order then.
    if (!after.codEnabled && before.codEnabled && !themeSupportsCardCheckout(themeAfter)) {
      throw cardUnsupported('payments.codEnabled', CARD_CHECKOUT_UNSUPPORTED_MESSAGE);
    }
    // Sprint 5 (D-107, SB-1 follow-up): cash on delivery off while card is not available leaves shoppers no way to pay. Checked on the
    // RESULT, after the SB-11 theme rule above, so a theme that cannot take card keeps its own, more specific answer.
    if (!after.codEnabled && !cardPaymentsAvailable()) {
      throw new HttpError(422, NO_USABLE_PAYMENT_METHOD_MESSAGE, NO_USABLE_PAYMENT_METHOD, 'payments');
    }
    set.paymentSettings = pay;
    fields.add('paymentSettings');
  }
  // Sprint 5 EP-11 (D-107): the phone confirmation mode and the risk rules. Only the fields sent change; the rest keep their value.
  if (update.fraud) {
    const current = readFraud(pay);
    const sent = Object.fromEntries(Object.entries(update.fraud.riskRules ?? {}).filter(([, value]) => value !== undefined));
    pay.fraud = {
      codConfirmation: update.fraud.codConfirmation ?? current.codConfirmation,
      riskRules: { ...current.riskRules, ...sent },
    };
    set.paymentSettings = pay;
    fields.add('paymentSettings');
  }
  // ...and the other way round: switching to such a theme while COD is off (a store already on it keeps working as it is).
  if (update.theme && !readPayments(pay).codEnabled && themeAfter !== themeBefore && !themeSupportsCardCheckout(themeAfter)) {
    throw cardUnsupported('theme.activeTheme', CARD_CHECKOUT_UNSUPPORTED_THEME_MESSAGE);
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
