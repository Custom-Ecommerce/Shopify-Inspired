import "server-only";

import type { ThemeSlug } from "@markaz/platform-kit/themes";
import {
  TransportConfigError,
  normalizeBaseUrl,
  parseDataSourceSetting,
  parseRemoteMode,
  resolveTransportKind,
  selectTransport,
  type BffStoreLookup,
  type StorefrontTransport,
  createMockTransport,
} from "@markaz/storefront-data/server";
import { resolveStore } from "@/lib/tenancy/resolve-store";
import { getTheme } from "@/lib/themes";

/**
 * Where a storefront request's data comes from (blueprint section 2.2). Routes build one of these
 * from their params. Containers receive it and never read the URL themselves.
 */
export type StorefrontSource =
  | { kind: "tenant"; key: string } // T3: slug
  | { kind: "demo"; themeSlug: ThemeSlug } // T2: fixtures, checkout disabled
  | { kind: "domain"; host: string }; // T4: custom domain (needs by=domain, finding F4)

// Read once when the server loads this module. A typo in an env value fails the build or the boot,
// not a shopper's request. With NODE_ENV=production, STOREFRONT_DATA_SOURCE=mock also fails here.
const DATA_SOURCE = parseDataSourceSetting(process.env.STOREFRONT_DATA_SOURCE);
const REMOTE_MODE = parseRemoteMode(process.env.STOREFRONT_REMOTE_MODE);
resolveTransportKind({ sourceKind: "tenant", dataSource: DATA_SOURCE, nodeEnv: process.env.NODE_ENV });

const demoTransports = new Map<string, StorefrontTransport>();

/**
 * Development only: STOREFRONT_DATA_SOURCE=mock makes live (tenant) stores read fixtures, for working without a seller
 * backend. It never applies to a demo host, which always reads fixtures. A production boot refuses it (see above), so in
 * production this is always false and a live store always reads the seller backend.
 */
function tenantsUseFixtures(): boolean {
  return DATA_SOURCE === "mock" && process.env.NODE_ENV !== "production";
}

const warnedFixtureKeys = new Set<string>();

/** Says on the server console, once per store per process, that a live store is not reading its database. */
function warnTenantFixtures(key: string): void {
  if (warnedFixtureKeys.has(key)) return;
  warnedFixtureKeys.add(key);
  const bar = "!".repeat(78);
  console.warn(
    "\n" + bar + "\n" +
      "[storefront] STOREFRONT_DATA_SOURCE=mock: the live store \"" + key + "\" is showing FIXTURE data, not its database.\n" +
      "[storefront] Unset STOREFRONT_DATA_SOURCE (or set it to remote) to read the seller backend.\n" +
      bar + "\n",
  );
}

/** A theme that ships its own demo catalogue gets a mock transport over it; any other theme keeps the shared fixtures. */
async function demoTransportFor(themeSlug: string): Promise<StorefrontTransport> {
  const cached = demoTransports.get(themeSlug);
  if (cached) return cached;
  const theme = await getTheme(themeSlug);
  const transport = theme.demo ? createMockTransport(theme.demo.fixtures) : selectTransport("mock");
  demoTransports.set(themeSlug, transport);
  return transport;
}

/**
 * Returns the transport for a source, or null when a tenant's store is not serving. The tenant
 * layout normally redirects first, so callers turn null into notFound().
 */
export async function resolveTransport(source: StorefrontSource): Promise<StorefrontTransport | null> {
  // A demo host always reads the theme's own fixtures. STOREFRONT_DATA_SOURCE is not consulted for it, so "remote"
  // cannot break a demo and the seller backend is never called from one.
  if (source.kind === "demo") return demoTransportFor(source.themeSlug);

  // Live stores read the seller backend. The only exception is the development override, which prints a warning.
  if (tenantsUseFixtures()) {
    warnTenantFixtures(source.kind === "tenant" ? source.key : source.host);
    return selectTransport("mock");
  }

  if (source.kind !== "tenant") {
    throw new TransportConfigError("Only tenant sources can use the remote transport so far.");
  }

  // Shares React's per-request cache with the tenant layout, so this is not a second backend call.
  const lookup = await resolveStore(source.key, "slug");
  if (lookup.outcome !== "ok") return null;

  return selectTransport("remote", {
    baseUrl: normalizeBaseUrl(process.env.SELLER_BACKEND_API_URL || "http://localhost:4001"),
    storeId: lookup.store.id,
    mode: REMOTE_MODE,
  });
}

/**
 * The BFF's view of a store: resolves the tenant and binds a remote transport to it, or says why it cannot. The transport
 * carries the shopper's IP, so the backend's per-client limits apply to the shopper and not to this server.
 */
export async function resolveOrderTransport(key: string, clientIp: string | null): Promise<BffStoreLookup> {
  if (tenantsUseFixtures()) {
    warnTenantFixtures(key);
    return { outcome: "ok", transport: selectTransport("mock") };
  }

  const lookup = await resolveStore(key, "slug");
  if (lookup.outcome === "not-found") return { outcome: "not-found" };
  if (lookup.outcome === "unavailable") return { outcome: "inactive", status: lookup.status };
  if (lookup.outcome === "error") return { outcome: "error" };

  return {
    outcome: "ok",
    transport: selectTransport("remote", {
      baseUrl: normalizeBaseUrl(process.env.SELLER_BACKEND_API_URL || "http://localhost:4001"),
      storeId: lookup.store.id,
      mode: REMOTE_MODE,
      clientIp,
    }),
  };
}
/* @theme-integration-patch:sources */
