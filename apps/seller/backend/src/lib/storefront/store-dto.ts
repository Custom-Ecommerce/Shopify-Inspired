import { storefrontStoreSchema } from '@/lib/contracts';
import { Media } from '@/lib/services';

/** A Mongo document as .lean() returns it. Mixed fields stay unknown until read defensively. */
export interface StoreRow {
  _id: unknown;
  slug: string;
  name: string;
  internalHandle?: string | null;
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
  const [logoUrl, seoImageUrl] = await Promise.all([mediaUrl(sf.logo, store._id), mediaUrl(sf.seoImage, store._id)]);

  return storefrontStoreSchema.parse({
    id: String(store._id),
    slug: store.slug,
    internalHandle: store.internalHandle ?? null,
    name: store.name,
    status,
    isThemeDemo: store.isThemeDemo === true,
    branding: {
      logoUrl,
      announcementText: text(sf.announcementText),
      // No source for banners yet: the storefront renders none.
      heroBanners: [],
    },
    seo: { title: text(sf.seoTitle), description: text(sf.seoDescription), imageUrl: seoImageUrl },
    commerce: {
      currency: 'PKR',
      // Cash on delivery is on unless the seller turned it off; card is on only when explicitly enabled.
      codEnabled: pay.codEnabled !== false,
      cardEnabled: pay.cardEnabled === true,
      deliveryRate: amount(sf.deliveryRate) ?? 0,
      freeDeliveryThreshold: amount(sf.freeDeliveryThreshold),
      whatsappNumber: text(sf.whatsappNumber),
    },
    features: { socialProofEnabled: false },
    theme: { activeTheme: text(sf.activeTheme) },
  });
}
