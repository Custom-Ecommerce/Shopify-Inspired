import type { Metadata } from "next";
import { Suspense } from "react";
import { SyncView } from "@/components/sync/sync-view";

export const metadata: Metadata = { title: "Sync" };

export default function SyncPage() {
  return (
    <Suspense fallback={null}>
      <SyncView />
    </Suspense>
  );
}
