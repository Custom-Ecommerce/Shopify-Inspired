"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ROLE_CLOSED_TEXT, roleMayOpen } from "@/lib/role-access";

/** Sprint 8 (D-118): a team member who opens a page their role does not have (by its address) is told so instead of being shown a page that cannot work. */
export function RoleGate({ role, children }: { role: unknown; children: ReactNode }) {
  const pathname = usePathname();
  if (roleMayOpen(role, pathname)) return <>{children}</>;
  return (
    <div className="flex min-w-0 flex-col gap-2 p-4 sm:p-8">
      <p className="text-sm text-muted-foreground" role="status">
        {ROLE_CLOSED_TEXT}
      </p>
    </div>
  );
}
