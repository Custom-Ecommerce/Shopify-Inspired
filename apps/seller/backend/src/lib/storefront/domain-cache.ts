import { PUBLIC_CACHE_HEADERS } from '@/lib/storefront/errors';

/**
 * S7-B6: the cache headers of a store answered by its custom domain: the same short public cache as any store record, plus a cache tag keyed by
 * the host (`domain-resolve:<host>`, the tag the seller backend purges when the domain is verified, changed or disconnected). Cache-Tag is read by
 * CDNs that support it; Vercel-Cache-Tag by Vercel's. The tag is the same string the storefront fetch carries (platform-kit domainResolveTag).
 */
export function domainCacheHeaders(host: string): Record<string, string> {
  const tag = 'domain-resolve:' + host;
  return { ...PUBLIC_CACHE_HEADERS, 'Cache-Tag': tag, 'Vercel-Cache-Tag': tag };
}
