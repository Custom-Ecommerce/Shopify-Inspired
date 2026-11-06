import type { Metadata } from "next";
import { Suspense } from "react";
import { CommissionPageView } from "@/components/commission/commission-view";

export const metadata: Metadata = { title: "Commission" };

export default function CommissionPage() {
  return (
    <Suspense fallback={null}>
      <CommissionPageView />
    </Suspense>
  );
}
