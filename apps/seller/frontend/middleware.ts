import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function parseJwt(token: string) {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch (e) {
    return null;
  }
}

// /accept-invite (S8-B2): the link in a staff invite email, opened with or without a session (the page says what to do).
// /unsubscribe (EP-07.US04): the link in a broadcast email, opened by a customer who has no seller session.
const PUBLIC_ACCOUNT_PAGES = ['/forgot-password', '/reset-password', '/verify-email', '/unsubscribe', '/accept-invite'];

export function middleware(request: NextRequest) {
  if (request.nextUrl.searchParams.has('clear')) {
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.set('markaz-session', '', { maxAge: 0, path: '/' });
    return response;
  }

  // Sprint 4 EP-08: the account links from emails open with or without a session.
  const path = request.nextUrl.pathname;
  if (PUBLIC_ACCOUNT_PAGES.some((page) => path === page || path.startsWith(page + '/'))) {
    return NextResponse.next();
  }

  const token = request.cookies.get('markaz-session')?.value;
  const isAuthPage = request.nextUrl.pathname.startsWith('/login') || request.nextUrl.pathname.startsWith('/signup');

  if (token) {
    const decoded = parseJwt(token);
    if (!decoded) {
      const response = isAuthPage 
        ? NextResponse.next() 
        : NextResponse.redirect(new URL('/login?error=unauthorized', request.url));
      
      response.cookies.set('markaz-session', '', { 
        maxAge: 0, 
        path: '/',
        domain: process.env.COOKIE_DOMAIN || undefined 
      });
      return response;
    }
  }

  if (!token && !isAuthPage) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (token && isAuthPage) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)'],
};
