import "../../../globals.css";
import React from 'react';
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
  if (result.outcome !== 'ok') redirect('/store-unavailable');

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
    noindex: false,
    effectiveTheme,
    commerce: {
      currency: store.commerce.currency,
      locale: 'en-PK',
      codEnabled: store.commerce.codEnabled,
      cardEnabled: store.commerce.cardEnabled,
      deliveryRate: store.commerce.deliveryRate,
      freeDeliveryThreshold: store.commerce.freeDeliveryThreshold ?? DEFAULT_FREE_DELIVERY_THRESHOLD,
      whatsappNumber: store.commerce.whatsappNumber,
    },
    branding: {
      logoUrl: store.branding.logoUrl,
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
      <StorefrontProvider storeKey={store.id}>
        <StoreShell snapshot={snapshot} theme={theme} chrome={chrome}>
          <div className="tenant-boundary">{children}</div>
        </StoreShell>
        {result.previewToken !== null && <PreviewBanner notLiveYet={store.status !== 'active'} />}
      </StorefrontProvider>
    </TenantProvider>
  );
}
