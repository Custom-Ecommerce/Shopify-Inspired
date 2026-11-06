import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { PREVIEW_COOKIE_NAME, PREVIEW_CREDENTIAL_HEADER, PREVIEW_QUERY_PARAM, isPreviewTokenShape } from '@markaz/platform-kit/preview';
import { RESERVED_SUBDOMAINS, STORE_SLUG_MAX_LENGTH, STORE_SLUG_MIN_LENGTH } from '@markaz/platform-kit/reservation';
import { THEME_MANIFEST } from '@markaz/platform-kit/themes';
import { PREVIEW_CACHE_CONTROL, confirmPreviewToken, previewCookie, previewSecondsLeft, withoutPreviewParam } from '@markaz/storefront-data/preview';

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

/**
 * A preview link was opened on a store host (D-019). The token leaves the URL here whatever happens: a good one becomes the
 * host-only cookie, anything else just lands on the live store. Only the seller backend can say which it is.
 */
async function enterPreview(request: NextRequest, storeKey: string, host: string): Promise<NextResponse> {
  const url = request.nextUrl;
  const token = url.searchParams.get(PREVIEW_QUERY_PARAM);
  const scheme = (request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')).split(',')[0].trim();
  const response = redirectTo(`${scheme}://${host}${withoutPreviewParam(url.pathname, url.search)}`, 307);
  response.headers.set('cache-control', PREVIEW_CACHE_CONTROL);
  response.headers.set('referrer-policy', 'no-referrer');

  if (isPreviewTokenShape(token)) {
    const baseUrl = process.env.SELLER_BACKEND_API_URL || 'http://localhost:4001';
    if (await confirmPreviewToken({ baseUrl, storeKey, token })) {
      const seconds = previewSecondsLeft(token, Date.now());
      if (seconds > 0) response.headers.append('set-cookie', previewCookie(token, seconds, process.env.NODE_ENV === 'production'));
    }
  }
  return response;
}

export async function middleware(request: NextRequest) {
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
  // Only the cookie below may set this. A browser that sends the header itself is not believed.
  requestHeaders.delete(PREVIEW_CREDENTIAL_HEADER);

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
    // Later requests read the cookie and never the query. The token rides on to the server as a request header; the seller
    // backend checks it for this exact store on every call, so a stale or foreign cookie simply gets the live store.
    const previewToken = request.cookies.get(PREVIEW_COOKIE_NAME)?.value;
    const hasPreviewCookie = isPreviewTokenShape(previewToken);
    if (hasPreviewCookie) requestHeaders.set(PREVIEW_CREDENTIAL_HEADER, previewToken);
    // The storefront API lives under /api/storefront on the store's own host. Pass it through with the tenant
    // headers set, so the BFF can tell which store the request is for. Rewriting it would send it to a page route.
    if (url.pathname.startsWith('/api/storefront/')) {
      return NextResponse.next({ request: { headers: requestHeaders } });
    }
    if (url.searchParams.has(PREVIEW_QUERY_PARAM)) return enterPreview(request, label, host);
    const res = NextResponse.rewrite(new URL('/tenant/' + label + url.pathname + url.search, request.url), { request: { headers: requestHeaders } });
    res.headers.set('x-robots-tag', 'noindex');
    if (hasPreviewCookie) {
      res.headers.set('cache-control', PREVIEW_CACHE_CONTROL);
      res.headers.append('vary', 'Cookie');
    }
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
