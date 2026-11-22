import {
  STOREFRONT_SLUG_PATTERN,
  STOREFRONT_STORE_LOOKUPS,
} from '@/lib/contracts';
import { validateCustomDomain } from '@/lib/domain-validation';
import { StorefrontHttpError } from '@/lib/storefront/errors';

export type StoreLookupBy = 'slug' | 'handle' | 'domain';

export interface StoreLookup {
  by: StoreLookupBy;
  key: string;
  filter: Record<string, unknown>;
}

/** Reads the optional ?by= param. Omitted is fine (auto); an unknown value is a 400. */
export function parseLookupBy(raw: string | null): StoreLookupBy | null {
  if (raw === null || raw.trim() === '') return null;
  const value = raw.trim().toLowerCase();
  if ((STOREFRONT_STORE_LOOKUPS as readonly string[]).includes(value)) return value as StoreLookupBy;
  throw new StorefrontHttpError(400, 'INVALID_REQUEST', 'by must be one of: ' + STOREFRONT_STORE_LOOKUPS.join(', '));
}

/**
 * Builds the store query for a key, or null when the key cannot be a store (no query is made).
 *
 * - slug:   stores.slug
 * - handle: stores.internalHandle
 * - domain: stores.domain, and only once the domain is verified. A pending, failed or disconnected domain must
 *           never serve a storefront, and is answered exactly like an unknown store (404, no reason).
 * Without ?by=, a key containing a dot is a domain and anything else is a slug.
 */
export function buildStoreLookup(rawKey: string, by: StoreLookupBy | null): StoreLookup | null {
  const key = rawKey.trim().toLowerCase();
  const mode: StoreLookupBy = by ?? (key.includes('.') ? 'domain' : 'slug');

  if (mode === 'domain') {
    // S7-B6: the host is normalised with the same helper the seller connected it with (lower-case punycode). A host that helper refuses (an IP,
    // a platform host, a reserved name, a bad shape) cannot be a stored domain, so it never reaches the database.
    const checked = validateCustomDomain(key);
    if (!checked.ok) return null;
    return { by: mode, key: checked.host, filter: { domain: checked.host, customDomainStatus: 'verified' } };
  }
  if (!STOREFRONT_SLUG_PATTERN.test(key)) return null;
  return { by: mode, key, filter: mode === 'slug' ? { slug: key } : { internalHandle: key } };
}
