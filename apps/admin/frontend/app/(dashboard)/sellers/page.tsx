import type { Metadata } from "next";
import { Suspense } from "react";
import { SellersView } from "@/components/sellers/sellers-view";

export const metadata: Metadata = { title: "Sellers" };

export default function SellersPage() {
  return (
    <Suspense fallback={null}>
      <SellersView />
    </Suspense>
  );
}
