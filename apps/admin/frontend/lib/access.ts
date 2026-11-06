export type AccessDecision = { action: "allow" } | { action: "redirect"; to: string };

/**
 * Decides whether a request may continue. Only the presence of the session cookie is checked here: the dashboard
 * layout verifies the session with the backend. A request with a stale cookie reaches /login, which never redirects
 * away on the cookie alone, so there is no redirect loop.
 */
export function decideAccess(pathname: string, hasSessionCookie: boolean): AccessDecision {
  if (pathname === "/login" || pathname.startsWith("/api/")) return { action: "allow" };
  if (hasSessionCookie) return { action: "allow" };
  const to = pathname === "/" ? "/login" : "/login?next=" + encodeURIComponent(pathname);
  return { action: "redirect", to };
}

/** The path to go to after sign-in. Only same-site paths are accepted, so the next parameter cannot send a user away. */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  return raw;
}
