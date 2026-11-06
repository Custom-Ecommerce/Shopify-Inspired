import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { RESERVED_SUBDOMAINS, STORE_SLUG_MAX_LENGTH, STORE_SLUG_MIN_LENGTH } from '@markaz/platform-kit/reservation';
import { THEME_MANIFEST } from '@markaz/platform-kit/themes';

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|theme-assets/).*)',
  ],
};

/** A store's host label: the platform-kit slug limit, as a DNS label (no hyphen at either end). */
const STORE_LABEL = new RegExp(`^[a-z0-9][a-z0-9-]{${STORE_SLUG_MIN_LENGTH - 2},${STORE_SLUG_MAX_LENGTH - 2}}[a-z0-9]$`);

/**
 * Emits a redirect with an explicit absolute `location`. Relative locations are
 * resolved against the request host by browsers, which turns a redirect to the
 * platform root into a redirect back to the subdomain it came from.
 */
function redirectTo(target: string, status: 307 | 308): NextResponse {
  return new NextResponse(null, { status, headers: { location: target } });
}

export function middleware(request: NextRequest) {
  const url = request.nextUrl;
  const rawHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  
  let host = rawHost.toLowerCase();
  if (host.endsWith('.')) host = host.slice(0, -1);
  
  if (
    url.pathname.startsWith('/tenant') ||
    url.pathname.startsWith('/demo') ||
    url.pathname.startsWith('/custom') ||
    url.pathname.startsWith('/_internal')
  ) {
    return new NextResponse(null, { status: 404 });
  }

  const rootDomain = process.env.ROOT_DOMAIN || 'localhost:3000';
  const platformHostnames = (process.env.PLATFORM_HOSTNAMES || '127.0.0.1,[::1]').split(',');

  if (url.pathname === '/store-not-found' || url.pathname === '/store-unavailable') {
    return NextResponse.next();
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete('x-markaz-tier');
  requestHeaders.delete('x-markaz-kind');
  requestHeaders.delete('x-markaz-tenant');
  requestHeaders.delete('x-markaz-theme');
  requestHeaders.delete('x-markaz-noindex');

  // T1: Marketing / Platform Hosts
  if (host === rootDomain || platformHostnames.includes(host)) {
    requestHeaders.set('x-markaz-tier', 'T1');
    requestHeaders.set('x-markaz-kind', 'marketing');
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // T4: Custom Domain Candidate
  const isSubdomain = host.endsWith('.' + rootDomain);
  if (!isSubdomain) {
    requestHeaders.set('x-markaz-tier', 'T4');
    requestHeaders.set('x-markaz-kind', 'custom');
    requestHeaders.set('x-markaz-tenant', host);
    return NextResponse.rewrite(new URL('/custom/' + host + url.pathname + url.search, request.url), { request: { headers: requestHeaders } });
  }

  const labelsString = host.replace('.' + rootDomain, '');
  const labels = labelsString.split('.');

  // T3 (Tenant) & Reserved
  if (labels.length === 1) {
    const label = labels[0];
    
    if (label === 'www') {
      // Production canonicalizes www -> apex with a redirect to the public domain.
      // In local development the apex *is* the server's own origin, and Next turns
      // a same-origin Location into a relative one that loops back to www, so there
      // we serve the marketing site directly instead.
      if (rootDomain.includes('localhost')) {
        requestHeaders.set('x-markaz-tier', 'T1');
        requestHeaders.set('x-markaz-kind', 'marketing');
        return NextResponse.next({ request: { headers: requestHeaders } });
      }
      return redirectTo(`${url.protocol}//${rootDomain}${url.pathname}${url.search}`, 308);
    }

    if (['mail', 'ftp', 'cdn', 'static', 'assets', 'media', 'img', 'images', 'files', 'smtp', 'imap', 'pop', 'sftp', 'ns1', 'ns2', 'mx', 'webmail', 'autodiscover', 'vpn', 'git'].includes(label)) {
      return new NextResponse(null, { status: 404 });
    }
    
    // Theme slugs are reserved too, so this must run before the reserved branch.
    const themeKeys: string[] = THEME_MANIFEST.map((t) => t.slug);
    if (themeKeys.includes(label)) {
      return NextResponse.rewrite(new URL('/themes/' + label, request.url), { request: { headers: requestHeaders } });
    }

    const reservedList = Array.isArray(RESERVED_SUBDOMAINS) ? RESERVED_SUBDOMAINS : Object.keys(RESERVED_SUBDOMAINS || {});
    const isReserved = reservedList.includes(label) || ['admin', 'seller', 'dashboard', 'portal', 'api', 'login'].includes(label);
    
    if (isReserved) {
       if (['admin', 'seller', 'dashboard', 'portal', 'api', 'login'].includes(label)) {
         return redirectTo(process.env.SELLER_PORTAL_URL || 'http://localhost:3002', 307);
       }
       requestHeaders.set('x-markaz-tier', 'T1');
       requestHeaders.set('x-markaz-kind', 'marketing');
       return NextResponse.next({ request: { headers: requestHeaders } });
    }

    
    if (!STORE_LABEL.test(label) || label.startsWith('xn--')) {
      return new NextResponse(null, { status: 404 });
    }
    
    requestHeaders.set('x-markaz-tier', 'T3');
    requestHeaders.set('x-markaz-kind', 'tenant');
    requestHeaders.set('x-markaz-tenant', label);
    // The storefront API lives under /api/storefront on the store's own host. Pass it through with the tenant
    // headers set, so the BFF can tell which store the request is for. Rewriting it would send it to a page route.
    if (url.pathname.startsWith('/api/storefront/')) {
      return NextResponse.next({ request: { headers: requestHeaders } });
    }
    const res = NextResponse.rewrite(new URL('/tenant/' + label + url.pathname + url.search, request.url), { request: { headers: requestHeaders } });
    res.headers.set('x-robots-tag', 'noindex');
    return res;
  }
  
  // T2: Demo (theme.<slug>.<root>)
  if (labels.length === 2 && labels[0] === 'theme') {
    const themeSlug = labels[1];
    const themeKeys: string[] = THEME_MANIFEST.map((t) => t.slug);
    
    if (themeKeys.includes(themeSlug)) {
      requestHeaders.set('x-markaz-tier', 'T2');
      requestHeaders.set('x-markaz-kind', 'demo');
      requestHeaders.set('x-markaz-theme', themeSlug);
      requestHeaders.set('x-markaz-noindex', 'true');
      const res = NextResponse.rewrite(new URL('/demo/' + themeSlug + url.pathname + url.search, request.url), { request: { headers: requestHeaders } });
      res.headers.set('x-robots-tag', 'noindex');
      return res;
    } else {
      return NextResponse.rewrite(new URL('/themes?unknown=' + encodeURIComponent(themeSlug), request.url));
    }
  }
  
  return new NextResponse(null, { status: 404 });
}
/* @theme-integration-patch:middleware */
