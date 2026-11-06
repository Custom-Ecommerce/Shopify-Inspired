import type { Metadata } from "next";
import { Suspense } from "react";
import { StoresView } from "@/components/stores/stores-view";

export const metadata: Metadata = { title: "Stores" };

export default function StoresPage() {
  return (
    <Suspense fallback={null}>
      <StoresView />
    </Suspense>
  );
}
