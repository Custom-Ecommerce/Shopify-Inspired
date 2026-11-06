"use client";

import { ArticleForm } from "@/components/dashboard/ArticleForm";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";

export default function NewArticlePage() {
  return (
    <div className="p-6 sm:p-8">
      <PageHeader title="New Article" />
      <ArticleForm />
    </div>
  );
}
