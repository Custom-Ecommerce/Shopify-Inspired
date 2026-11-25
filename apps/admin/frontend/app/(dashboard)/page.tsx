import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { homeFor } from "@/components/dashboard/nav-config";
import { OverviewView } from "@/components/overview/overview-view";
import { SESSION_COOKIE } from "@/lib/cookie";
import { readSession } from "@/lib/session";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  // Sprint 6 (S6-B6): a level without the overview lands on the first page it can use (the server refuses the overview for it anyway).
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await readSession(token) : null;
  if (session?.status === "ok" && !session.capabilities.includes("overview.read")) {
    const home = homeFor(session.capabilities);
    if (home !== "/") redirect(home);
  }
  return <OverviewView />;
}
