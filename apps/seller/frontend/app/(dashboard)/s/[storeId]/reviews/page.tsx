"use client";

import type { Review as PayloadReviewDoc } from "@markaz/contracts";
import type { ListEnvelope as PayloadFindResponse } from "@markaz/api-compat";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { useEffect, useState } from "react";

import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { StatusBadge } from "@/components/dashboard/shared/StatusBadge";
import { DataTable } from "@/components/dashboard/shared/DataTable";
import { LoadingState } from "@/components/dashboard/shared/LoadingState";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";
import { ErrorState } from "@/components/dashboard/shared/ErrorState";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

export default function DashboardReviewsPage() {
  const storeFetch = useStoreFetch();
  const [reviews, setReviews] = useState<PayloadReviewDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");

  function load() {
    setIsLoading(true);
    const query = filter === "all" ? "" : `&where[status][equals]=${filter}`;
    storeFetch(`/api/dashboard/reviews?limit=100${query}`)
      .then((res) => res.json())
      .then((data: PayloadFindResponse<PayloadReviewDoc>) => setReviews(data.docs ?? []))
      .catch(() => setErrorMessage("Could not reach the backend."))
      .finally(() => setIsLoading(false));
  }

  useEffect(load, [filter, storeFetch]);

  async function updateStatus(id: string, status: "approved" | "rejected") {
    try {
      await storeFetch(`/api/dashboard/reviews/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      load();
    } catch {
      setErrorMessage("Could not reach the backend. Please try again.");
    }
  }

  const columns = [
    {
      header: "Rating",
      render: (r: PayloadReviewDoc) => (
        <div className="flex items-center gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <span key={i} className={i < r.rating ? "text-warning" : "text-muted"}>
              ★
            </span>
          ))}
        </div>
      ),
    },
    {
      header: "Review",
      render: (r: PayloadReviewDoc) => (
        <div className="max-w-md">
          <p className="text-sm text-muted-foreground mb-1">
            {typeof r.product === "object" ? r.product?.title : r.product}
          </p>
          {r.title && <p className="text-sm font-medium mb-1">{r.title}</p>}
          <p className="text-sm">{r.body}</p>
        </div>
      ),
    },
    {
      header: "Status",
      render: (r: PayloadReviewDoc) => <StatusBadge status={r.status ?? "unknown"} />,
    },
    {
      header: "Actions",
      render: (r: PayloadReviewDoc) => {
        if (r.status === "pending") {
          return (
            <div className="flex gap-2">
              <Button size="sm" variant="default" onClick={() => updateStatus(r.id, "approved")}>
                Approve
              </Button>
              <Button size="sm" variant="destructive" onClick={() => updateStatus(r.id, "rejected")}>
                Reject
              </Button>
            </div>
          );
        }
        return null;
      },
    },
  ];

  return (
    <div className="p-6 sm:p-8">
      <PageHeader title="Reviews" />

      <Tabs value={filter} onValueChange={(v) => { if (v) setFilter(v as typeof filter); }} className="mb-6">
        <TabsList variant="line">
          {(["pending", "approved", "rejected", "all"] as const).map((f) => (
            <TabsTrigger key={f} value={f} className="capitalize">{f}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {errorMessage ? (
        <ErrorState message={errorMessage} onRetry={load} className="mb-6" />
      ) : isLoading ? (
        <LoadingState />
      ) : reviews.length === 0 ? (
        <EmptyState title="No reviews here" description="You don't have any reviews matching this filter." />
      ) : (
        <SectionCard noPadding>
          <DataTable
            data={reviews}
            columns={columns}
            keyExtractor={(r) => r.id}
          />
        </SectionCard>
      )}
    </div>
  );
}
