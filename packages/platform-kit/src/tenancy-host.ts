/**
 * S7-B6 (D-118): which kind of host a storefront request came in on, and the rules that go with it. Pure, no I/O, so the edge middleware and
 * the tests run the same code.
 *
 *   platform   the marketing site (the root domain, or one of PLATFORM_HOSTNAMES)
 *   subdomain  <label>.<root>: a store, a theme demo or a reserved label (the middleware tells those apart)
 *   custom     any other host: a candidate custom domain. It is only ever served when the seller backend says it is VERIFIED.
 *   invalid    not a host name at all
 */

export type HostKind = "platform" | "subdomain" | "custom" | "invalid";

export interface HostClassification {
  kind: HostKind;
  /** The clean host: lower-case, no port, no trailing dot. Empty for an invalid host. */
  host: string;
}

/** A host name as DNS allows it: labels of letters, digits and hyphens, at least two labels (a custom domain has a dot). */
const DNS_HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** The host of a request: lower-case, the port and a trailing dot removed. Null for anything that is not a host name (an IPv6 literal included). */
export function cleanRequestHost(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  // The first value only: a header joined by a proxy ("a.com, b.com") names the outermost, never a list.
  let host = raw.split(",")[0]!.trim().toLowerCase();
  if (host === "" || host.startsWith("[")) return null;
  host = host.replace(/:\d{1,5}$/, "");
  if (host.endsWith(".")) host = host.slice(0, -1);
  return DNS_HOST.test(host) ? host : null;
}

/**
 * The key a custom domain is looked up by: a clean host with a dot (a store slug or handle never has one, so a key with a dot is always a domain). Null for
 * anything else, and then no request is made.
 */
export function customDomainKey(raw: string | null | undefined): string | null {
  const host = cleanRequestHost(raw);
  return host !== null && host.includes(".") ? host : null;
}

const stripPort = (value: string): string => value.trim().toLowerCase().replace(/:\d{1,5}$/, "");

export interface HostSettings {
  /** ROOT_DOMAIN, for example markazify.com or localhost:3000. */
  rootDomain: string;
  /** PLATFORM_HOSTNAMES, comma separated. */
  platformHostnames: string;
}

/**
 * Classifies a host. The root domain is compared with its port and without it, so `localhost:3000` in the setting and a `localhost` host
 * header are the same host. A platform hostname is matched as written (an IPv6 literal like [::1] is one), before the host is cleaned.
 */
export function classifyHost(rawHost: string | null | undefined, settings: HostSettings): HostClassification {
  const root = stripPort(settings.rootDomain);
  const platform = settings.platformHostnames.split(",").map(stripPort).filter((value) => value !== "");
  const written = rawHost === null || rawHost === undefined ? "" : stripPort(rawHost.split(",")[0]!.replace(/\.$/, ""));
  if (written !== "" && (written === root || platform.includes(written))) return { kind: "platform", host: written };
  const host = cleanRequestHost(rawHost);
  if (host === null) return { kind: "invalid", host: "" };
  if (host === root || platform.includes(host)) return { kind: "platform", host };
  if (host.endsWith("." + root)) return { kind: "subdomain", host };
  return { kind: "custom", host };
}

/** The label of a store subdomain, when the host is exactly one label under the root. Null otherwise. */
export function subdomainLabel(host: string, rootDomain: string): string | null {
  const root = stripPort(rootDomain);
  if (!host.endsWith("." + root)) return null;
  const rest = host.slice(0, host.length - root.length - 1);
  return rest.includes(".") || rest === "" ? null : rest;
}

export type HostEnv = Readonly<Record<string, string | undefined>>;

/**
 * Whether a proxy in front of this app writes x-forwarded-host itself (so the header can be believed). The same environment that
 * decides which client address is believed (TRUSTED_PROXY_HOPS, TRUSTED_CLIENT_IP_HEADER, D-081), and the Vercel platform (VERCEL is set
 * there, and Vercel overwrites the header). With none of these the header may have been written by the client.
 */
export function forwardedHostTrusted(env: HostEnv): boolean {
  const hops = (env.TRUSTED_PROXY_HOPS ?? "").trim();
  if (/^\d+$/.test(hops) && Number(hops) > 0) return true;
  if ((env.TRUSTED_CLIENT_IP_HEADER ?? "").trim() !== "") return true;
  return (env.VERCEL ?? "").trim() !== "";
}

/**
 * The host a request is for, as written (lower-case, the port kept, the first value of a joined header). x-forwarded-host only when the
 * proxy rules above say it can be trusted; otherwise the Host header. A client that can reach the app directly therefore cannot pick a
 * store (or a custom domain) with a forged forwarded header. Null when there is none.
 */
export function requestHostWithPort(headers: { get(name: string): string | null }, env: HostEnv): string | null {
  const forwarded = headers.get("x-forwarded-host");
  const chosen = forwardedHostTrusted(env) && forwarded !== null && forwarded.trim() !== "" ? forwarded : headers.get("host");
  if (chosen === null) return null;
  const first = chosen.split(",")[0]!.trim().toLowerCase();
  return first === "" ? null : first;
}

/** The clean host of a request (see requestHostWithPort): no port, no trailing dot. Null for anything that is not a host name. */
export function requestHostFromHeaders(headers: { get(name: string): string | null }, env: HostEnv): string | null {
  return cleanRequestHost(requestHostWithPort(headers, env));
}

/**
 * Whether a host may take a seller's preview (D-019). Only a store's own subdomain does: the preview link is always built on
 * `<slug>.<root>`, and the cookie is host-only. A custom host never reads a preview cookie or a preview token in its URL, so no preview of
 * one store can show on a host that belongs to another.
 */
export function hostAllowsPreview(kind: HostKind): boolean {
  return kind === "subdomain";
}

export interface RedirectInput {
  /** The host the request came in on, and its kind. */
  requestHost: string;
  requestKind: HostKind;
  /** The store, as the public record says. */
  store: { status: string; domain: string | null; redirectToCustomDomain: boolean };
  /** True for a seller's preview: never redirected. */
  preview: boolean;
  /** The path and query of the request, starting with a slash. */
  pathAndSearch: string;
  /** https unless the request came in on http (local development). */
  scheme?: "http" | "https";
}

/**
 * S7-B6: where the platform subdomain of a store sends a visitor when the seller turned "redirect to my domain" ON: the same path on the
 * custom host, as a permanent redirect. Null (no redirect) unless ALL hold: the request is on a store subdomain, the store is live, the
 * domain is verified (the public record carries `domain` only then), the setting is on, and it is not a preview. A custom host never
 * redirects, so there can be no loop.
 */
export function customDomainRedirect(input: RedirectInput): string | null {
  if (input.requestKind !== "subdomain" || input.preview) return null;
  const { store } = input;
  if (store.status !== "active" || store.redirectToCustomDomain !== true) return null;
  const domain = store.domain === null ? null : cleanRequestHost(store.domain);
  if (domain === null || domain === input.requestHost) return null;
  // Leading slashes collapse to one, so a path like //evil.test can never become a redirect to another host.
  const path = "/" + input.pathAndSearch.replace(/^\/+/, "");
  return (input.scheme ?? "https") + "://" + domain + path;
}
