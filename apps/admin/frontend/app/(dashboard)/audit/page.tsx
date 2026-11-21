import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { AuditView } from "@/components/audit/audit-view";
import { SESSION_COOKIE } from "@/lib/cookie";
import { readSession } from "@/lib/session";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage() {
  // The export is owner level only: the server refuses anyone else, the button is only shown to an owner.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await readSession(token) : null;
  const canExport = session?.status === "ok" && session.capabilities.includes("audit.export");
  return (
    <Suspense fallback={null}>
      <AuditView canExport={canExport} />
    </Suspense>
  );
}
