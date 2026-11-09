/**
 * Which address a request really came from (D-081). Pure, so the seller backend's limiter and the storefront's BFF run
 * the same rule. A client can send any x-forwarded-for it likes, so the header is only read as far as the environment
 * says it can be trusted:
 *
 *   TRUSTED_CLIENT_IP_HEADER=x-real-ip  one header that a proxy in front of this app always sets itself
 *   TRUSTED_PROXY_HOPS=1                how many proxies in front of this app append to x-forwarded-for
 *   neither                             the address of the connection itself
 *
 * x-forwarded-for grows to the right, so only the rightmost entries were written by a proxy. With N hops the client is
 * the Nth from the right, and anything further left is whatever the client sent.
 */

/** Set on every request by stampSocketAddresses, overwriting anything the client sent under this name. */
export const SOCKET_ADDRESS_HEADER = "x-markaz-socket-ip";

/** Only ever set by stampSocketAddresses. Without it the header above could have come from the client. */
const STAMP_ACTIVE = "__markazSocketAddressStamp";

/** process.env, or the same two names in a test. */
export type TrustedProxySettings = Readonly<Record<string, string | undefined>>;

export function markSocketStampActive(): void {
  (globalThis as Record<string, unknown>)[STAMP_ACTIVE] = true;
}

export function isSocketStampActive(): boolean {
  return (globalThis as Record<string, unknown>)[STAMP_ACTIVE] === true;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6 = /^[0-9a-f:.]{2,45}$/i;

/** An address in one form, or null for anything that is not one: a value here becomes part of a stored key. */
export function cleanAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (/^::ffff:/i.test(value)) value = value.slice(7);
  const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(value);
  if (withPort) value = withPort[1] ?? value;
  if (IPV4.test(value)) return value;
  return value.includes(":") && IPV6.test(value) ? value.toLowerCase() : null;
}

function parsedHops(value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value.trim())) return 0;
  return Number(value.trim());
}

function fromSocket(headers: Headers): string | null {
  return isSocketStampActive() ? cleanAddress(headers.get(SOCKET_ADDRESS_HEADER)) : null;
}

/**
 * The client's address, or null when it cannot be known. A request with fewer forwarded entries than the configured hops
 * did not pass through those proxies, so its entries prove nothing and the connection's address is used instead.
 */
export function resolveClientIp(headers: Headers, settings: TrustedProxySettings): string | null {
  const named = settings.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
  // Naming x-forwarded-for here would mean trusting the raw header, which is the one thing this module exists to prevent.
  if (named && named !== "x-forwarded-for") {
    return cleanAddress(headers.get(named)) ?? fromSocket(headers);
  }

  const hops = parsedHops(settings.TRUSTED_PROXY_HOPS);
  if (hops > 0) {
    const entries = (headers.get("x-forwarded-for") ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
    return cleanAddress(entries[entries.length - hops]) ?? fromSocket(headers);
  }

  return fromSocket(headers);
}
