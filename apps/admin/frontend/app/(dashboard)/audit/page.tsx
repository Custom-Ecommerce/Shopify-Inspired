import type { Metadata } from "next";
import { Suspense } from "react";
import { AuditView } from "@/components/audit/audit-view";

export const metadata: Metadata = { title: "Audit log" };

export default function AuditPage() {
  return (
    <Suspense fallback={null}>
      <AuditView />
    </Suspense>
  );
}
