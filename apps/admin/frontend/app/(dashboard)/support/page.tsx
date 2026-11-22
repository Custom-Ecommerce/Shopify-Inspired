import type { Metadata } from "next";
import { Suspense } from "react";
import { SupportView } from "@/components/support/support-view";

export const metadata: Metadata = { title: "Support" };

export default function SupportPage() {
  return (
    <Suspense fallback={null}>
      <SupportView />
    </Suspense>
  );
}
