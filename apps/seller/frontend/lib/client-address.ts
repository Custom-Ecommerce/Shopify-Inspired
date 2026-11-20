import { resolveClientIp } from "@markaz/platform-kit/client-ip";
import { signedClientAddressHeaders } from "@markaz/platform-kit/signed-client-address";

/**
 * Sprint 4 (D-097, A3): this app calls its backend server to server, so the backend only sees this server's address.
 * The browser's address, resolved here with this app's own trusted-proxy rule (TRUSTED_PROXY_HOPS or
 * TRUSTED_CLIENT_IP_HEADER), is signed with CLIENT_ADDRESS_SIGNING_SECRET (the same value on the backend) and sent as
 * x-markaz-client-address. The backend believes it only with a valid signature (60 seconds, this scope). With no secret or
 * no resolvable address nothing is sent, and the backend skips its per-IP limit. Server code only.
 */
export const PORTAL_CLIENT_SCOPE = "account-portal";

export function clientAddressHeaders(headers: Headers): Record<string, string> {
  return signedClientAddressHeaders(process.env.CLIENT_ADDRESS_SIGNING_SECRET ?? "", PORTAL_CLIENT_SCOPE, resolveClientIp(headers, process.env));
}
