import { mockTransport } from "./mock";
import { TransportConfigError } from "./errors";
import { createRemoteTransport, type RemoteMode } from "./remote";
import type { StorefrontTransport, TransportKind } from "./types";

/** Source kinds from blueprint section 2.2. The app's StorefrontSource carries the same discriminants. */
export type SourceKind = "tenant" | "demo" | "domain";

export type DataSourceSetting = TransportKind;

/** Parses STOREFRONT_DATA_SOURCE. Unset or empty means "decide by source". Anything else is a typo. */
export function parseDataSourceSetting(raw: string | undefined): DataSourceSetting | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (raw === "mock" || raw === "remote") return raw;
  throw new TransportConfigError("STOREFRONT_DATA_SOURCE must be mock or remote, got: " + raw);
}

/** Parses STOREFRONT_REMOTE_MODE. Unset means http: the seller backend serves the storefront API. "stub" opts out. */
export function parseRemoteMode(raw: string | undefined): RemoteMode {
  if (raw === undefined || raw === "" || raw === "http") return "http";
  if (raw === "stub") return "stub";
  throw new TransportConfigError("STOREFRONT_REMOTE_MODE must be http or stub, got: " + raw);
}

export interface TransportChoiceInput {
  sourceKind: SourceKind;
  /** The parsed STOREFRONT_DATA_SOURCE, when set. */
  dataSource?: DataSourceSetting;
  /** NODE_ENV. Passed in so this function stays pure. */
  nodeEnv?: string;
}

/**
 * Decides which transport a source uses. Pure: the environment is passed in, not read.
 *   - An explicit setting wins. "mock" in production is refused.
 *   - Otherwise demo sources use fixtures, and tenant and domain sources use the remote transport.
 */
export function resolveTransportKind(input: TransportChoiceInput): TransportKind {
  if (input.dataSource === "mock" && input.nodeEnv === "production") {
    throw new TransportConfigError("STOREFRONT_DATA_SOURCE=mock is not allowed in production.");
  }
  if (input.dataSource) return input.dataSource;
  return input.sourceKind === "demo" ? "mock" : "remote";
}

export interface RemoteSelection {
  baseUrl: string;
  storeId: string;
  mode: RemoteMode;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** The shopper's IP as the BFF trusts it. The backend uses it for its per-client limits. */
  clientIp?: string | null;
  /** A preview the backend accepted. Set only from the store lookup. */
  previewToken?: string | null;
}

/** Builds the transport for a decided kind. Mock is shared; remote is bound to one store. */
export function selectTransport(kind: TransportKind, remote?: RemoteSelection): StorefrontTransport {
  if (kind === "mock") return mockTransport;
  if (!remote) throw new TransportConfigError("The remote transport needs a store to bind to.");
  return createRemoteTransport(remote);
}
