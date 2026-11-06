"use client";

import type { ListEnvelope as PayloadFindResponse } from "@markaz/api-compat";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { useState } from "react";

import { useDashboardFetch } from "@/lib/hooks/use-dashboard-fetch";
import { RefreshButton } from "@/components/dashboard/shared/RefreshButton";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { StatusBadge } from "@/components/dashboard/shared/StatusBadge";
import { DataTable } from "@/components/dashboard/shared/DataTable";
import { LoadingState } from "@/components/dashboard/shared/LoadingState";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";
import { ErrorState } from "@/components/dashboard/shared/ErrorState";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ReturnDoc {
  id: string;
  order: string | { orderId?: string };
  reason: string;
  description?: string;
  status: "requested" | "approved" | "rejected" | "completed";
  refundType?: string;
  refundAmount?: number;
}

export default function DashboardReturnsPage() {
  const storeFetch = useStoreFetch();
  const [filter, setFilter] = useState<"requested" | "approved" | "rejected" | "completed" | "all">("requested");
  const query = filter === "all" ? "" : `&where[status][equals]=${filter}`;
  
  const { data, loading, error, refetch: load } = useDashboardFetch<PayloadFindResponse<ReturnDoc>>(
    `/api/dashboard/returns?limit=100${query}`
  );
  const returns = data?.docs ?? [];

  const [drafts, setDrafts] = useState<Record<string, { refundType: string; refundAmount: string }>>({});

  async function updateStatus(r: ReturnDoc, status: "approved" | "rejected" | "completed") {
    const draft = drafts[r.id];
    const body: Record<string, unknown> = { status };
    if (status === "approved" && draft?.refundType) {
      body.refundType = draft.refundType;
      body.refundAmount = draft.refundAmount ? Number(draft.refundAmount) : undefined;
    }
    await storeFetch(`/api/dashboard/returns/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    load();
  }

  const columns = [
    {
      header: "Order",
      render: (r: ReturnDoc) => (
        <span className="font-mono text-sm">
          {typeof r.order === "object" ? r.order?.orderId : r.order}
        </span>
      ),
    },
    {
      header: "Details",
      render: (r: ReturnDoc) => (
        <div>
          <p className="text-sm capitalize mb-1">{r.reason.replace("_", " ")}</p>
          {r.description && <p className="text-sm text-muted-foreground">{r.description}</p>}
        </div>
      ),
    },
    {
      header: "Status",
      render: (r: ReturnDoc) => <StatusBadge status={r.status} />,
    },
    {
      header: "Actions",
      render: (r: ReturnDoc) => {
        if (r.status === "requested") {
          return (
            <div className="flex flex-col gap-2 min-w-[240px]">
              <div className="flex gap-2">
                <Select
                  value={drafts[r.id]?.refundType ?? "store_credit"}
                  onValueChange={(v) => {
                    if (v) {
                      setDrafts((d) => ({
                        ...d,
                        [r.id]: {
                          ...d[r.id],
                          refundType: v,
                          refundAmount: d[r.id]?.refundAmount ?? "",
                        },
                      }));
                    }
                  }}
                >
                  <SelectTrigger className="w-32 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="store_credit">Store credit</SelectItem>
                    <SelectItem value="cod_refund">COD refund</SelectItem>
                    <SelectItem value="replacement">Replacement</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  placeholder="Amount"
                  value={drafts[r.id]?.refundAmount ?? ""}
                  onChange={(e) =>
                    setDrafts((d) => ({
                      ...d,
                      [r.id]: {
                        ...d[r.id],
                        refundType: d[r.id]?.refundType ?? "store_credit",
                        refundAmount: e.target.value,
                      },
                    }))
                  }
                  className="w-24 h-8 text-xs"
                />
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="default" onClick={() => updateStatus(r, "approved")} className="h-8">
                  Approve
                </Button>
                <Button size="sm" variant="destructive" onClick={() => updateStatus(r, "rejected")} className="h-8">
                  Reject
                </Button>
              </div>
            </div>
          );
        }
        if (r.status === "approved") {
          return (
            <Button size="sm" variant="outline" onClick={() => updateStatus(r, "completed")}>
              Mark completed
            </Button>
          );
        }
        return null;
      },
    },
  ];

  return (
    <div className="p-6 sm:p-8">
      <PageHeader title="Returns">
        <RefreshButton />
      </PageHeader>

      <Tabs value={filter} onValueChange={(v) => { if (v) setFilter(v as typeof filter); }} className="mb-6">
        <TabsList variant="line">
          {(["requested", "approved", "rejected", "completed", "all"] as const).map((f) => (
            <TabsTrigger key={f} value={f} className="capitalize">{f}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {error ? (
        <ErrorState message={error} onRetry={load} className="mb-6" />
      ) : loading ? (
        <LoadingState />
      ) : returns.length === 0 ? (
        <EmptyState title="No returns here" description="You don't have any returns matching this filter." />
      ) : (
        <SectionCard noPadding>
          <DataTable
            data={returns}
            columns={columns}
            keyExtractor={(r) => r.id}
          />
        </SectionCard>
      )}
    </div>
  );
}
