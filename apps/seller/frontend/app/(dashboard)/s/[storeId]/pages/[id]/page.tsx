"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PageForm } from "@/components/dashboard/PageForm";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { LoadingState } from "@/components/dashboard/shared/LoadingState";
import { ErrorState } from "@/components/dashboard/shared/ErrorState";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import type { PageDetail } from "@/lib/pages";

export default function EditPagePage() {
  const storeFetch = useStoreFetch();
  const params = useParams<{ id: string }>();
  const [page, setPage] = useState<PageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    storeFetch(`/api/dashboard/storePages/${params.id}`, { cache: "no-store" })
      .then((res) => res.json().catch(() => null))
      .then((data) => {
        if (data?.id) setPage(data);
        else setError(typeof data?.error === "string" ? data.error : "Page not found.");
      })
      .catch(() => setError("Could not reach the backend."))
      .finally(() => setLoading(false));
  }, [params.id, storeFetch]);

  return (
    <div className="p-4 sm:p-8">
      <PageHeader title="Edit page" />
      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}
      {page && <PageForm page={page} />}
    </div>
  );
}
