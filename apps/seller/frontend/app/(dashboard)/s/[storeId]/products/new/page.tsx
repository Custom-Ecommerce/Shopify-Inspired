"use client";

import { ProductForm } from "@/components/dashboard/ProductForm";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";

export default function NewProductPage() {
  return (
    <div className="p-6 sm:p-8">
      <PageHeader title="Add Product" />
      <ProductForm />
    </div>
  );
}
