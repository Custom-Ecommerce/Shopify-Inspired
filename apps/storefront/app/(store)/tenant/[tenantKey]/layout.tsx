import "../../../globals.css";
import React from 'react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { StorefrontProvider } from '@markaz/storefront-data/client';
import { loadStoreChrome } from '@markaz/storefront-data/server';
import { resolveStore } from '@/lib/tenancy/resolve-store';
import { resolveTransport } from '@/lib/sources';
import { getTheme, resolveEffectiveTheme } from '@/lib/themes';
import { ThemeScope } from '@/components/theme-scope';
import { TenantProvider, type TenantSnapshot } from '@/context/tenant-context';
import { StoreShell } from '@/containers/shell';
import { PreviewBanner } from '@/components/preview-banner';

/** Fallback when a store has no free-delivery threshold configured. */
const DEFAULT_FREE_DELIVERY_THRESHOLD = 5000;

/** The address this request came in on (the store's own host), for absolute links in the head tags. Null when it cannot be read. */
async function requestOrigin(): Promise<string | null> {
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    if (!host) return null;
    const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
    return proto + '://' + host;
  } catch {
    return null;
  }
}

/**
 * The head tags of every page of a store (GAP 13, Sprint 4 SB-5): the title and description from the store's SEO fields
 * (the name and profile description when empty), Open Graph and Twitter tags, and robots. A store that is not live, and
 * any Preview, is noindex (D-078). resolveStore is wrapped in React cache(), so this shares the layout's own read. A page
 * with its own title (product pages) overrides the title; the home page adds the canonical link.
 */
export async function generateMetadata({ params }: { params: Promise<{ tenantKey: string }> }): Promise<Metadata> {
  const { tenantKey } = await params;
  const result = await resolveStore(tenantKey, 'slug');
  if (result.outcome !== 'ok') return { robots: { index: false, follow: false } };
  const store = result.store;
  const title = store.seo.title ?? store.name;
  const description = store.seo.description ?? store.profile?.description ?? undefined;
  const image = store.seo.imageUrl ?? store.branding.bannerUrl ?? store.branding.logoUrl ?? null;
  const origin = await requestOrigin();
  const live = store.status === 'active' && result.previewToken === null;
  return {
    title: { absolute: title },
    description,
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    openGraph: { type: 'website', siteName: store.name, title, description, ...(image ? { images: [{ url: image }] } : {}) },
    twitter: { card: image ? 'summary_large_image' : 'summary', title, description, ...(image ? { images: [image] } : {}) },
    robots: live ? { index: true, follow: true } : { index: false, follow: false },
  };
}

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantKey: string }>;
}) {
  const { tenantKey } = await params;
  const result = await resolveStore(tenantKey, 'slug');

  // `redirect` returns `never`, so after these two checks TypeScript narrows
  // `result` to the `ok` branch and `result.store` is typed.
  if (result.outcome === 'error') redirect('/store-not-found');
  // Sprint 4 EP-04.US06 (D-094): a store that has not gone live yet shows a plain "opening soon" page with no products.
  // Its owner still sees it through Preview (the backend serves a pending store to a valid preview token).
  if (result.outcome !== 'ok') redirect(result.outcome === 'unavailable' && result.status === 'pending' ? '/store-unavailable?state=opening' : '/store-unavailable');

  const store = result.store;
  const effectiveTheme = resolveEffectiveTheme(store.theme.activeTheme);
  const theme = await getTheme(effectiveTheme.slug);

  const snapshot: TenantSnapshot = {
    tenantKind: 'tenant',
    storeId: store.id,
    slug: store.slug,
    internalHandle: store.internalHandle ?? '',
    storeName: store.name,
    storeStatus: store.status,
    checkoutEnabled: store.status === 'active',
    noindex: store.status !== 'active' || result.previewToken !== null,
    effectiveTheme,
    commerce: {
      currency: store.commerce.currency,
      locale: 'en-PK',
      codEnabled: store.commerce.codEnabled,
      cardEnabled: store.commerce.cardEnabled,
      deliveryRate: store.commerce.deliveryRate,
      freeDeliveryThreshold: store.commerce.freeDeliveryThreshold ?? DEFAULT_FREE_DELIVERY_THRESHOLD,
      whatsappNumber: store.commerce.whatsappNumber,
      deliveryEstimate: store.commerce.deliveryEstimate ?? null,
    },
    profile: store.profile,
    social: store.social,
    branding: {
      logoUrl: store.branding.logoUrl,
      bannerUrl: store.branding.bannerUrl ?? null,
      announcementText: store.branding.announcementText,
      socialProofEnabled: store.features.socialProofEnabled,
    },
  };

  // Themes that build navigation and search from the catalogue ask for it once here. Others never trigger the extra reads.
  const transport = theme.wantsChrome ? await resolveTransport({ kind: 'tenant', key: tenantKey }) : null;
  const chrome = transport ? await loadStoreChrome(transport) : undefined;

  // The storefront provider keeps this store's cart apart from every other store's, and sends orders and quotes through
  // the same-origin BFF.
  return (
    <TenantProvider value={snapshot}>
      <ThemeScope slug={effectiveTheme.slug} />
      <StorefrontProvider storeKey={store.id} cardEnabled={store.commerce.cardEnabled} codEnabled={store.commerce.codEnabled} preview={result.previewToken !== null}>
        <StoreShell snapshot={snapshot} theme={theme} chrome={chrome}>
          <div className="tenant-boundary">{children}</div>
        </StoreShell>
        {result.previewToken !== null && <PreviewBanner notLiveYet={store.status !== 'active'} />}
      </StorefrontProvider>
    </TenantProvider>
  );
}
