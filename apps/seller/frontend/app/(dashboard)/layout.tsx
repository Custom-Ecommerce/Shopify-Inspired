/**
 * Auth gate for everything behind login: the workspace portal (`/`, `/stores`)
 * and every store dashboard (`/s/[storeId]/…`).
 *
 * This layout deliberately renders NO chrome. A store's shell (sidebar,
 * switcher, providers) belongs to `s/[storeId]/layout.tsx`, which validates
 * the URL's `storeId`; the workspace pages wrap themselves in `WorkspaceShell`.
 * Nothing here knows about "the" store — that concept no longer exists outside
 * the route segment (Phase 6B).
 */

import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authFailureView } from "@/components/dashboard/WorkspaceNotice";
import { getDashboardUser } from "@/lib/dashboard-auth";
import type { DashboardUser } from "@/lib/types/dashboard";

export default async function DashboardGateLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get("markaz-session")?.value;

  let user: DashboardUser | null;
  try {
    user = await getDashboardUser(token);
  } catch (err) {
    return authFailureView(err); // BACKEND_OFFLINE → notice
  }

  if (!user) {
    redirect("/login?clear=1");
  }

  return <>{children}</>;
}
