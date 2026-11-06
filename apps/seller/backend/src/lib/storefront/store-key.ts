import {
  STOREFRONT_DOMAIN_PATTERN,
  STOREFRONT_SLUG_PATTERN,
  STOREFRONT_STORE_LOOKUPS,
} from '@/lib/contracts';
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
 * - domain: stores.domain, and only once the domain is verified. A pending or failed domain must
 *           never serve a storefront.
 * Without ?by=, a key containing a dot is a domain and anything else is a slug.
 */
export function buildStoreLookup(rawKey: string, by: StoreLookupBy | null): StoreLookup | null {
  const key = rawKey.trim().toLowerCase();
  const mode: StoreLookupBy = by ?? (key.includes('.') ? 'domain' : 'slug');

  if (mode === 'domain') {
    if (!STOREFRONT_DOMAIN_PATTERN.test(key)) return null;
    return { by: mode, key, filter: { domain: key, customDomainStatus: 'verified' } };
  }
  if (!STOREFRONT_SLUG_PATTERN.test(key)) return null;
  return { by: mode, key, filter: mode === 'slug' ? { slug: key } : { internalHandle: key } };
}
