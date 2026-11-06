import type { Metadata } from "next";
import { Suspense } from "react";
import { CategoriesView } from "@/components/categories/categories-view";

export const metadata: Metadata = { title: "Categories" };

export default function CategoriesPage() {
  return (
    <Suspense fallback={null}>
      <CategoriesView />
    </Suspense>
  );
}
