import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { safeNextPath } from "@/lib/access";
import { SESSION_COOKIE } from "@/lib/cookie";
import { readSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const NOTICES: Record<string, string> = {
  expired: "Your session has ended. Sign in again.",
  unavailable: "The admin service is unavailable. Try again shortly.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string }> }) {
  const params = await searchParams;
  const next = safeNextPath(params.next);

  // A valid session skips the form. A request that arrives with a reason never redirects, so a stale cookie cannot loop.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token && !params.reason) {
    const session = await readSession(token);
    if (session.status === "ok") redirect(next);
  }

  const notice = params.reason ? NOTICES[params.reason] : undefined;
  return (
    <AuthShell>
      <LoginForm next={next} notice={notice} />
    </AuthShell>
  );
}
