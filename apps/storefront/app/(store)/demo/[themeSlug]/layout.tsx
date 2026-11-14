import "../../../globals.css";
import React from 'react';
import type { ThemeSlug } from '@markaz/platform-kit/themes';
import { StorefrontProvider } from '@markaz/storefront-data/client';
import { loadStoreChrome } from '@markaz/storefront-data/server';
import { resolveTransport } from '@/lib/sources';
import { requireDemoTheme } from '@/lib/themes';
import { ThemeScope } from '@/components/theme-scope';

export default async function DemoLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ themeSlug: string }>;
}) {
  const resolvedParams = await params;
  const theme = await requireDemoTheme(resolvedParams.themeSlug);
  const Layout = theme.Layout;

  // A theme without its own demo data keeps the generic preview: fixtures from the data layer, a top banner, fixed copy.
  if (!theme.demo) {
    return (
      <div className="demo-provider-boundary">
        <div className="bg-blue-600 text-white text-center py-2 text-sm font-medium">
          Previewing Theme: {resolvedParams.themeSlug} (Mock checkout: no orders are saved)
        </div>
        <Layout
          store={{
            name: 'Demo Store',
            logoUrl: null,
            announcement: null,
            currency: 'PKR',
            locale: 'en-PK',
          }}
          nav={{
            links: [
              { label: 'Products', href: '/products' },
              { label: 'Track order', href: '/track' },
            ],
          }}
          footer={{ links: [], copyright: 'Demo storefront preview' }}
          lang="en"
          dir="ltr"
        >
          {children}
        </Layout>
      </div>
    );
  }

  // A theme with demo data: everything below comes from the theme's own fixtures, never from the seller backend.
  const transport = theme.wantsChrome ? await resolveTransport({ kind: 'demo', themeSlug: resolvedParams.themeSlug as ThemeSlug }) : null;
  const chrome = transport ? await loadStoreChrome(transport) : undefined;
  const demo = theme.demo;

  return (
    <>
      <ThemeScope slug={resolvedParams.themeSlug} />
      <StorefrontProvider demoFixtures={demo.fixtures} demoScope={resolvedParams.themeSlug}>
        <div className="demo-provider-boundary">
          {demo.banner === 'top' && (
            <div className="bg-blue-600 text-white text-center py-2 text-sm font-medium">
              Previewing Theme: {resolvedParams.themeSlug} (Mock checkout: no orders are saved)
            </div>
          )}
          <Layout store={demo.store} nav={demo.nav} footer={demo.footer} chrome={chrome} mode="demo" lang="en" dir="ltr">
            {children}
          </Layout>
          {demo.banner === 'overlay' && (
            <div
              style={{
                position: 'fixed',
                left: 12,
                bottom: 12,
                zIndex: 2147483000,
                pointerEvents: 'none',
                background: 'rgba(17,17,17,0.85)',
                color: '#fff',
                font: '600 11px/1 system-ui, sans-serif',
                padding: '7px 10px',
                borderRadius: 999,
              }}
            >
              Demo data — no orders are saved
            </div>
          )}
        </div>
      </StorefrontProvider>
    </>
  );
}
