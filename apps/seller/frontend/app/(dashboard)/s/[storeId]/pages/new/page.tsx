"use client";

import { PageForm } from "@/components/dashboard/PageForm";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";

export default function NewPagePage() {
  return (
    <div className="p-4 sm:p-8">
      <PageHeader title="New page" />
      <PageForm />
    </div>
  );
}
