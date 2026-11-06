import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decideAccess } from "@/lib/access";
import { SESSION_COOKIE } from "@/lib/cookie";

export function middleware(request: NextRequest) {
  const decision = decideAccess(request.nextUrl.pathname, request.cookies.has(SESSION_COOKIE));
  if (decision.action === "allow") return NextResponse.next();
  return NextResponse.redirect(new URL(decision.to, request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
