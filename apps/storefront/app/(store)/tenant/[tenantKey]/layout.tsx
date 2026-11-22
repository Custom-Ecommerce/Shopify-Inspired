import "../../../globals.css";
import React from 'react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { permanentRedirect, redirect } from 'next/navigation';
import { classifyHost, customDomainRedirect, requestHostWithPort } from '@markaz/platform-kit/tenancy-host';
import { canonicalStoreOrigin } from '@markaz/storefront-data';
import { StorefrontProvider } from '@markaz/storefront-data/client';
import { loadContentFooterLinks, loadStoreChrome } from '@markaz/storefront-data/server';
import { resolveStore } from '@/lib/tenancy/resolve-store';
import { resolveTransport } from '@/lib/sources';
import { getTheme, resolveEffectiveTheme } from '@/lib/themes';
import { ThemeScope } from '@/components/theme-scope';
import { TenantProvider, type TenantSnapshot } from '@/context/tenant-context';
import { StoreShell } from '@/containers/shell';
import { PreviewBanner } from '@/components/preview-banner';
import { requestOrigin } from '@/lib/request-origin';

/** Fallback when a store has no free-delivery threshold configured. */
const DEFAULT_FREE_DELIVERY_THRESHOLD = 5000;

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
  // S7-B6: a store with a verified custom domain is canonical on it, whichever host this request came in on (the platform subdomain keeps working).
  const origin = canonicalStoreOrigin({ requestOrigin: await requestOrigin(), customDomain: store.customDomain });
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

  // S7-B6: the seller asked the platform address to send visitors to the custom domain. A permanent redirect (308) to the same path, only for a live store
  // with a VERIFIED domain, never for a preview, and never from the custom host itself (so no loop). Decided by customDomainRedirect (platform-kit, tested).
  if (tenantKey.includes('.') === false) {
    const h = await headers();
    const requestHost = requestHostWithPort(h, process.env) ?? '';
    const kind = classifyHost(requestHost, { rootDomain: process.env.ROOT_DOMAIN || 'localhost:3000', platformHostnames: process.env.PLATFORM_HOSTNAMES || '127.0.0.1,[::1]' });
    const target = customDomainRedirect({
      requestHost: kind.host,
      requestKind: kind.kind,
      store: { status: store.status, domain: store.customDomain ?? null, redirectToCustomDomain: store.redirectToCustomDomain === true },
      preview: result.previewToken !== null,
      pathAndSearch: h.get('x-markaz-path') ?? '/',
      scheme: requestHost.includes('localhost') ? 'http' : 'https',
    });
    if (target !== null) permanentRedirect(target);
  }

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

  // Sprint 7 (S7-B3): the footer links the store's content adds: the published pages the seller put in the footer, and the Blog when there is an article.
  // Read under the store's static tag (a publish, unpublish or delete of an article or page drops it). Never throws for an unreachable backend.
  const contentTransport = transport ?? (await resolveTransport({ kind: 'tenant', key: tenantKey }));
  const contentLinks = contentTransport ? await loadContentFooterLinks(contentTransport) : [];

  // The storefront provider keeps this store's cart apart from every other store's, and sends orders and quotes through
  // the same-origin BFF.
  return (
    <TenantProvider value={snapshot}>
      <ThemeScope slug={effectiveTheme.slug} />
      <StorefrontProvider storeKey={store.id} cardEnabled={store.commerce.cardEnabled} codEnabled={store.commerce.codEnabled} preview={result.previewToken !== null}>
        <StoreShell snapshot={snapshot} theme={theme} chrome={chrome} contentLinks={contentLinks}>
          <div className="tenant-boundary">{children}</div>
        </StoreShell>
        {result.previewToken !== null && <PreviewBanner notLiveYet={store.status !== 'active'} />}
      </StorefrontProvider>
    </TenantProvider>
  );
}
