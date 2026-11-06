import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Header } from "@/components/dashboard/header";
import { Sidebar } from "@/components/dashboard/sidebar";
import { SESSION_COOKIE } from "@/lib/cookie";
import { readSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");

  const session = await readSession(token);
  if (session.status === "unauthorized") redirect("/login?reason=expired");
  if (session.status === "unavailable") redirect("/login?reason=unavailable");

  return (
    <div className="flex min-h-dvh w-full bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <Sidebar className="hidden md:flex" />
      <div className="relative flex w-full min-w-0 flex-1 flex-col bg-background">
        <Header user={session.user} />
        <main id="main-content" tabIndex={-1} className="flex-1 p-6 focus:outline-none sm:p-8">{children}</main>
      </div>
    </div>
  );
}
