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
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DiscountDoc {
  id: string;
  code: string;
  type: string;
  value: number;
  minOrderAmount?: number | null;
  maxUses?: number | null;
  usedCount: number;
  isActive: boolean;
}

const EMPTY_FORM = { code: "", type: "percentage", value: "", minOrderAmount: "", maxUses: "" };

export default function DashboardDiscountsPage() {
  const storeFetch = useStoreFetch();
  const { data, loading, error: fetchError, refetch: load } = useDashboardFetch<PayloadFindResponse<DiscountDoc>>("/api/dashboard/discounts");
  const discounts = data?.docs ?? [];

  const [formError, setFormError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const error = fetchError || formError;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const res = await storeFetch("/api/dashboard/discounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code.trim().toUpperCase(),
          type: form.type,
          value: Number(form.value),
          minOrderAmount: form.minOrderAmount ? Number(form.minOrderAmount) : undefined,
          maxUses: form.maxUses ? Number(form.maxUses) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data?.error ?? data?.errors?.[0]?.message ?? "Could not create discount.");
        return;
      }
      setShowForm(false);
      setForm(EMPTY_FORM);
      load();
    } catch {
      setFormError("Could not reach the backend. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(discount: DiscountDoc) {
    await storeFetch(`/api/dashboard/discounts/${discount.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !discount.isActive }),
    });
    load();
  }

  const columns = [
    { header: "Code", accessorKey: "code" as keyof DiscountDoc, className: "font-mono" },
    {
      header: "Type",
      render: (d: DiscountDoc) => <span className="capitalize">{d.type.replace("_", " ")}</span>,
    },
    {
      header: "Value",
      render: (d: DiscountDoc) => (d.type === "percentage" ? `${d.value}%` : d.value),
    },
    {
      header: "Used",
      render: (d: DiscountDoc) => `${d.usedCount}${d.maxUses ? ` / ${d.maxUses}` : ""}`,
    },
    {
      header: "Active",
      render: (d: DiscountDoc) => (
        <div className="flex items-center gap-2">
          <StatusBadge status={d.isActive ? "active" : "unset"} />
          <Button
            variant="clay-soft"
            size="sm"
            onClick={() => toggleActive(d)}
            className="h-7 px-2 text-xs"
          >
            {d.isActive ? "Deactivate" : "Activate"}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 sm:p-8">
      <PageHeader title="Discounts">
        <div className="flex gap-2">
          <Button variant="clay" onClick={() => setShowForm(true)}>New Coupon</Button>
          <RefreshButton />
        </div>
      </PageHeader>

      {loading ? (
        <LoadingState />
      ) : discounts.length === 0 ? (
        <EmptyState title="No discount codes yet" description="Create one to run a promotion." />
      ) : (
        <SectionCard noPadding>
          <DataTable
            data={discounts}
            columns={columns}
            keyExtractor={(d) => d.id}
          />
        </SectionCard>
      )}

      <Sheet open={showForm} onOpenChange={setShowForm}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>New Coupon</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleCreate} className="flex flex-col gap-4 px-6">
            <div>
              <Label htmlFor="code" className="mb-1">Code</Label>
              <Input
                id="code"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                required
                className="font-mono uppercase"
              />
            </div>
            <div>
              <Label className="mb-1">Type</Label>
              <Select value={form.type} onValueChange={(v) => { if (v) setForm((f) => ({ ...f, type: v })); }}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Percentage</SelectItem>
                  <SelectItem value="fixed_amount">Fixed Amount</SelectItem>
                  <SelectItem value="free_delivery">Free Delivery</SelectItem>
                  <SelectItem value="buy_x_get_y">Buy X Get Y</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="value" className="mb-1">Value</Label>
              <Input
                id="value"
                type="number"
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label htmlFor="minOrderAmount" className="mb-1">Min order amount</Label>
              <Input
                id="minOrderAmount"
                type="number"
                value={form.minOrderAmount}
                onChange={(e) => setForm((f) => ({ ...f, minOrderAmount: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="maxUses" className="mb-1">Max uses</Label>
              <Input
                id="maxUses"
                type="number"
                value={form.maxUses}
                onChange={(e) => setForm((f) => ({ ...f, maxUses: e.target.value }))}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <SheetFooter className="px-0">
              <Button type="submit" variant="clay" disabled={saving}>
                {saving ? "Creating…" : "Create coupon"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
