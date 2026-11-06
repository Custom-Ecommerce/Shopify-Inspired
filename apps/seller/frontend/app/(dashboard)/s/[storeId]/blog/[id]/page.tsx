"use client";

import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ArticleForm } from "@/components/dashboard/ArticleForm";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { LoadingState } from "@/components/dashboard/shared/LoadingState";
import { ErrorState } from "@/components/dashboard/shared/ErrorState";

interface ArticleApiResponse {
  id: string;
  title: string;
  slug: string;
  excerpt?: string | null;
  content?: unknown;
  type: string;
  status: string;
}

export default function EditArticlePage() {
  const storeFetch = useStoreFetch();
  const params = useParams<{ id: string }>();
  const [article, setArticle] = useState<ArticleApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    storeFetch(`/api/dashboard/storeArticles/${params.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.id) setArticle(data);
        else setError("Article not found.");
      })
      .catch(() => setError("Could not reach the backend."))
      .finally(() => setLoading(false));
  }, [params.id, storeFetch]);

  return (
    <div className="p-6 sm:p-8">
      <PageHeader title="Edit Article" />
      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {article && <ArticleForm article={article} />}
    </div>
  );
}
