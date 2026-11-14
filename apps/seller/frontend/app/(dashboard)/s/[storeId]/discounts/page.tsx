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
  startDate?: string | null;
  endDate?: string | null;
  isActive: boolean;
  archivedAt?: string | null;
}

const EMPTY_FORM = { code: "", type: "percentage", value: "", minOrderAmount: "", maxUses: "", startDate: "", endDate: "" };
type FormState = typeof EMPTY_FORM;

const isRetired = (d: DiscountDoc): boolean => d.type !== "percentage" && d.type !== "fixed_amount";

function valueLabel(d: DiscountDoc): string {
  if (d.type === "percentage") return `${d.value}% off`;
  if (d.type === "fixed_amount") return `Rs. ${d.value.toLocaleString("en-PK")} off`;
  return "Old type, not accepted at checkout";
}

function usedLabel(d: DiscountDoc): string {
  return typeof d.maxUses === "number" ? `${d.usedCount} / ${d.maxUses}` : `${d.usedCount} used`;
}

/** The yyyy-mm-dd a date input needs, in the seller's own timezone. */
function toDayInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function datesLabel(d: DiscountDoc): string {
  if (!d.startDate && !d.endDate) return "Any time";
  return `${d.startDate ? toDayInput(d.startDate) : "Now"} to ${d.endDate ? toDayInput(d.endDate) : "no end"}`;
}

/** A code runs from the start of its first day to the end of its last, in the seller's own timezone. */
const dayStart = (day: string): string | null => (day ? new Date(`${day}T00:00:00`).toISOString() : null);
const dayEnd = (day: string): string | null => (day ? new Date(`${day}T23:59:59.999`).toISOString() : null);

const optionalNumber = (text: string): number | null => (text.trim() === "" ? null : Number(text));

function errorText(body: unknown, fallback: string): string {
  const data = body as { issues?: Array<{ message?: string }>; errors?: Array<{ message?: string }>; error?: unknown } | null;
  return data?.issues?.[0]?.message ?? data?.errors?.[0]?.message ?? (typeof data?.error === "string" ? data.error : fallback);
}

export default function DashboardDiscountsPage() {
  const storeFetch = useStoreFetch();
  const active = useDashboardFetch<PayloadFindResponse<DiscountDoc>>("/api/dashboard/discounts");
  const archived = useDashboardFetch<PayloadFindResponse<DiscountDoc>>("/api/dashboard/discounts?archived=true");
  const discounts = active.data?.docs ?? [];
  const archivedDiscounts = archived.data?.docs ?? [];

  const [actionError, setActionError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<DiscountDoc | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const reload = () => {
    active.refetch();
    archived.refetch();
  };

  const field = (name: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(discount: DiscountDoc) {
    setEditing(discount);
    setForm({
      code: discount.code,
      type: discount.type,
      value: String(discount.value),
      minOrderAmount: discount.minOrderAmount == null ? "" : String(discount.minOrderAmount),
      maxUses: discount.maxUses == null ? "" : String(discount.maxUses),
      startDate: toDayInput(discount.startDate),
      endDate: toDayInput(discount.endDate),
    });
    setFormError(null);
    setShowForm(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const shared = {
      value: Number(form.value),
      minOrderAmount: optionalNumber(form.minOrderAmount),
      maxUses: optionalNumber(form.maxUses),
      startDate: dayStart(form.startDate),
      endDate: dayEnd(form.endDate),
    };
    try {
      const res = await storeFetch(editing ? `/api/dashboard/discounts/${editing.id}` : "/api/dashboard/discounts", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? shared : { ...shared, code: form.code.trim().toUpperCase(), type: form.type }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setFormError(errorText(data, "Could not save this code."));
        return;
      }
      setShowForm(false);
      reload();
    } catch {
      setFormError("Could not reach the backend. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function patch(discount: DiscountDoc, body: Record<string, unknown>) {
    setActionError(null);
    try {
      const res = await storeFetch(`/api/dashboard/discounts/${discount.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setActionError(errorText(await res.json().catch(() => null), "Could not update this code."));
        return;
      }
      reload();
    } catch {
      setActionError("Could not reach the backend. Please try again.");
    }
  }

  const codeColumn = {
    header: "Code",
    render: (d: DiscountDoc) => (
      <div className="min-w-0">
        <p className="font-mono font-medium break-all">{d.code}</p>
        <p className="text-xs text-muted-foreground">{valueLabel(d)}</p>
      </div>
    ),
  };
  const minimumColumn = {
    header: "Min order",
    className: "hidden md:table-cell",
    render: (d: DiscountDoc) => (d.minOrderAmount ? `Rs. ${d.minOrderAmount.toLocaleString("en-PK")}` : "None"),
  };
  const datesColumn = { header: "Dates", className: "hidden lg:table-cell", render: (d: DiscountDoc) => datesLabel(d) };
  const usedColumn = { header: "Used", render: (d: DiscountDoc) => <span className="tabular-nums whitespace-nowrap">{usedLabel(d)}</span> };

  const columns = [
    codeColumn,
    minimumColumn,
    datesColumn,
    usedColumn,
    {
      header: "Active",
      className: "hidden sm:table-cell",
      render: (d: DiscountDoc) => <StatusBadge status={d.isActive ? "active" : "unset"} />,
    },
    {
      header: "",
      render: (d: DiscountDoc) => (
        <div className="flex flex-wrap justify-end gap-1.5">
          {!isRetired(d) && (
            <Button variant="clay-soft" size="sm" className="h-7 px-2 text-xs" onClick={() => openEdit(d)}>
              Edit
            </Button>
          )}
          <Button variant="clay-soft" size="sm" className="h-7 px-2 text-xs" onClick={() => patch(d, { isActive: !d.isActive })}>
            {d.isActive ? "Deactivate" : "Activate"}
          </Button>
          <Button variant="clay-soft" size="sm" className="h-7 px-2 text-xs" onClick={() => patch(d, { archived: true })}>
            Archive
          </Button>
        </div>
      ),
    },
  ];

  const archivedColumns = [
    codeColumn,
    usedColumn,
    {
      header: "",
      render: (d: DiscountDoc) => (
        <div className="flex justify-end">
          <Button variant="clay-soft" size="sm" className="h-7 px-2 text-xs" onClick={() => patch(d, { archived: false })}>
            Restore
          </Button>
        </div>
      ),
    },
  ];

  const pageError = active.error || archived.error || actionError;

  return (
    <div className="p-4 sm:p-8">
      <PageHeader title="Discounts">
        <div className="flex gap-2">
          <Button variant="clay" onClick={openNew}>New Coupon</Button>
          <RefreshButton />
        </div>
      </PageHeader>

      {pageError && <p className="mb-4 text-sm text-destructive">{pageError}</p>}

      {active.loading ? (
        <LoadingState />
      ) : discounts.length === 0 ? (
        <EmptyState title="No discount codes yet" description="Create one to run a promotion." />
      ) : (
        <SectionCard noPadding>
          <DataTable data={discounts} columns={columns} keyExtractor={(d) => d.id} />
        </SectionCard>
      )}

      {archivedDiscounts.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-1 text-sm font-semibold">Archived</h2>
          <p className="mb-3 text-xs text-muted-foreground">These codes no longer work. Past orders keep their discount.</p>
          <SectionCard noPadding>
            <DataTable data={archivedDiscounts} columns={archivedColumns} keyExtractor={(d) => d.id} />
          </SectionCard>
        </div>
      )}

      <Sheet open={showForm} onOpenChange={setShowForm}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? `Edit ${editing.code}` : "New Coupon"}</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSave} className="flex flex-col gap-4 px-6 pb-6">
            {!editing && (
              <>
                <div>
                  <Label htmlFor="code" className="mb-1">Code</Label>
                  <Input id="code" value={form.code} onChange={field("code")} required maxLength={40} className="font-mono uppercase" />
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
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            <div>
              <Label htmlFor="value" className="mb-1">{form.type === "percentage" ? "Percent off (1 to 100)" : "Rupees off"}</Label>
              <Input id="value" type="number" inputMode="numeric" min={1} max={form.type === "percentage" ? 100 : undefined} step={1} value={form.value} onChange={field("value")} required />
            </div>
            <div>
              <Label htmlFor="minOrderAmount" className="mb-1">Minimum order (optional)</Label>
              <Input id="minOrderAmount" type="number" inputMode="numeric" min={0} step={1} value={form.minOrderAmount} onChange={field("minOrderAmount")} />
            </div>
            <div>
              <Label htmlFor="maxUses" className="mb-1">Maximum total uses (optional)</Label>
              <Input id="maxUses" type="number" inputMode="numeric" min={0} step={1} value={form.maxUses} onChange={field("maxUses")} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="startDate" className="mb-1">Starts (optional)</Label>
                <Input id="startDate" type="date" value={form.startDate} onChange={field("startDate")} />
              </div>
              <div>
                <Label htmlFor="endDate" className="mb-1">Ends (optional)</Label>
                <Input id="endDate" type="date" value={form.endDate} onChange={field("endDate")} />
              </div>
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <SheetFooter className="px-0">
              <Button type="submit" variant="clay" disabled={saving}>
                {saving ? "Saving…" : editing ? "Save changes" : "Create coupon"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
