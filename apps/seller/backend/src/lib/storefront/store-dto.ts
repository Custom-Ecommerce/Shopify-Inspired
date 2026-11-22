import { storefrontStoreSchema, toStorefrontThemeConfig } from '@/lib/contracts';
import { Media } from '@/lib/services';
import { cardPaymentsAvailable } from '@/lib/storefront/card-config';
import { readPayments, readThemeConfig } from '@/lib/store-settings';

/** A Mongo document as .lean() returns it. Mixed fields stay unknown until read defensively. */
export interface StoreRow {
  _id: unknown;
  slug: string;
  name: string;
  internalHandle?: string | null;
  /** S7-B6: the custom domain and its status. The public record carries the domain only when it is verified. */
  domain?: string | null;
  customDomainStatus?: string | null;
  isThemeDemo?: boolean;
  storefront?: unknown;
  paymentSettings?: unknown;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** Whole rupees (D-004): a store's settings are not validated yet, so a decimal is rounded where it is read. */
function amount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/** S7-B6: the store's custom domain, only when it is verified (a pending or failed one is never public). */
export function verifiedDomainOf(store: Pick<StoreRow, 'domain' | 'customDomainStatus'>): string | null {
  return store.customDomainStatus === 'verified' && typeof store.domain === 'string' && store.domain !== '' ? store.domain : null;
}

const HEX_ID = /^[0-9a-fA-F]{24}$/;

/** A media relation is a populated { url } or an ObjectId. Store-scoped, so one store cannot read another's media. */
async function mediaUrl(ref: unknown, storeId: unknown): Promise<string | null> {
  if (ref === null || ref === undefined) return null;
  if (typeof ref === 'object' && 'url' in (ref as object)) return text((ref as { url?: unknown }).url);
  const id = String(ref);
  if (!HEX_ID.test(id)) return null;
  const row = (await (Media as any).findOne({ _id: id, store: storeId }).select('url').lean()) as { url?: unknown } | null;
  return row ? text(row.url) : null;
}

/**
 * Projects an ACTIVE store to the storefront contract. The result is validated before it leaves. Only a preview the
 * backend accepted passes another status, for a pending store (A-012).
 */
export async function toStorefrontStoreDto(store: StoreRow, status: 'active' | 'pending' = 'active') {
  const sf = record(store.storefront);
  const pay = record(store.paymentSettings);
  const [logoUrl, bannerUrl, seoImageUrl] = await Promise.all([mediaUrl(sf.logo, store._id), mediaUrl(sf.banner, store._id), mediaUrl(sf.seoImage, store._id)]);
  const social = record(sf.social);
  // S7-B7: the validated theme config, defaults filled in (a stored value that fails its rule reads as the default). The hero picture is the store's own media.
  const themeConfig = readThemeConfig(sf);
  const heroImageUrl = await mediaUrl(themeConfig.heroImage, store._id);

  return storefrontStoreSchema.parse({
    id: String(store._id),
    slug: store.slug,
    internalHandle: store.internalHandle ?? null,
    customDomain: verifiedDomainOf(store),
    redirectToCustomDomain: verifiedDomainOf(store) !== null && sf.redirectToCustomDomain === true,
    name: store.name,
    status,
    isThemeDemo: store.isThemeDemo === true,
    branding: {
      logoUrl,
      bannerUrl,
      announcementText: text(sf.announcementText),
      // No source for banners yet: the storefront renders none.
      heroBanners: [],
    },
    seo: { title: text(sf.seoTitle), description: text(sf.seoDescription), imageUrl: seoImageUrl },
    commerce: {
      currency: 'PKR',
      // Cash on delivery is on unless the seller turned it off. Card depends on the platform's Stripe keys (A-015).
      codEnabled: pay.codEnabled !== false,
      // Sprint 4 EP-04.US03: the platform keys AND the store's own switch (missing = on, as before).
      cardEnabled: cardPaymentsAvailable() && readPayments(store.paymentSettings).cardEnabled,
      deliveryRate: amount(sf.deliveryRate) ?? 0,
      freeDeliveryThreshold: amount(sf.freeDeliveryThreshold),
      whatsappNumber: text(sf.whatsappNumber),
      deliveryEstimate: text(sf.deliveryEstimate),
    },
    profile: {
      description: text(sf.description),
      contactPhone: text(sf.contactPhone),
      contactEmail: text(sf.contactEmail),
      address: text(sf.address),
      city: text(sf.city),
    },
    social: { facebook: text(social.facebook), instagram: text(social.instagram), tiktok: text(social.tiktok), whatsapp: text(social.whatsapp) },
    features: { socialProofEnabled: false },
    theme: { activeTheme: text(sf.activeTheme) },
    themeConfig: toStorefrontThemeConfig(themeConfig, heroImageUrl),
  });
}
