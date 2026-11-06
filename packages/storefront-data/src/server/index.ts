/*
 * Server-side entry point. Routes and loaders import from here. Themes must not: they receive
 * props from the container, and the boundary is enforced by the theme import allowlist.
 */
export { loadCatalogPage } from "./catalog";
export { loadAllProducts } from "./all-products";
export type { AllProductsOptions } from "./all-products";
export { loadStoreChrome } from "./chrome";
export { loadHomePage } from "./home";
export type { HomePageData } from "./home";
export { loadCollectionPage } from "./collection";
export type { CollectionPageData } from "./collection";
export { createMockTransport } from "../transport/mock";
export { loadProductPage } from "./product";
export type { ProductPageData } from "./product";
export { loadSearchPage } from "./search";
export type { SearchPageData } from "./search";
export { createRemoteTransport, normalizeBaseUrl, STOREFRONT_API_PREFIX, DEFAULT_REMOTE_TIMEOUT_MS } from "../transport/remote";
export type { RemoteMode, RemoteTransportOptions } from "../transport/remote";
export {
  parseDataSourceSetting,
  parseRemoteMode,
  resolveTransportKind,
  selectTransport,
} from "../transport/select";
export type { DataSourceSetting, RemoteSelection, SourceKind, TransportChoiceInput } from "../transport/select";
export { TransportConfigError, TransportUnavailableError } from "../transport/errors";
export type { TransportUnavailableReason } from "../transport/errors";
export type { StorefrontTransport, TransportKind } from "../transport/types";
export { createBffRoutes, rejectionToEnvelope } from "../bff/handlers";
export type { BffDeps, BffRouteContext, BffRoutes, BffStoreLookup } from "../bff/handlers";
/* @theme-integration-patch:server-index */
