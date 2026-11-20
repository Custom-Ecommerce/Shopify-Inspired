"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Download, Loader2, Search } from "lucide-react";
import type { CustomerList, CustomerRow } from "@markaz/contracts";
import { FormAlert } from "@/components/auth/AccountCard";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useActiveStoreId } from "@/lib/dashboard-context";
import {
  CUSTOMER_PAGE_SIZE,
  DEFAULT_CUSTOMER_FILTERS,
  SORT_OPTIONS,
  customerPath,
  displayName,
  displayPhone,
  filterQuery,
  type CustomerFilters,
  type CustomerSortValue,
} from "@/lib/customer-view";
import { formatRs } from "@/lib/format";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { storeBasePath } from "@/lib/store-routes";

const dateOf = (iso: string | null): string => (iso === null ? "" : new Date(iso).toLocaleDateString("en-GB"));

async function problemOf(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof data?.error === "string" ? data.error : fallback;
}

const FILTER_CHIPS: ReadonlyArray<{ key: "repeat" | "hasEmail" | "unsubscribed"; label: string }> = [
  { key: "repeat", label: "Repeat customers" },
  { key: "hasEmail", label: "Has email" },
  { key: "unsubscribed", label: "Unsubscribed" },
];

/**
 * Sprint 5 EP-10.US02 (D-107): the seller's customers. Derived from orders, grouped by phone, so there is nothing to add or
 * delete here. Search, three filters, a sort, paging and a CSV export. At 375 px the rows are cards with no sideways scroll; from
 * the md breakpoint they are a table. Everything goes through the BFF proxy.
 */
export default function DashboardCustomersPage() {
  const storeId = useActiveStoreId();
  const storeFetch = useStoreFetch();
  const base = `/api/proxy/stores/${encodeURIComponent(storeId)}`;

  const [filters, setFilters] = useState<CustomerFilters>(DEFAULT_CUSTOMER_FILTERS);
  const [searchText, setSearchText] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CustomerList | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // A late answer of an older request must never replace a newer one.
  const latest = useRef(0);

  // The search box is applied half a second after the last key, and goes back to page 1.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((current) => (current.q === searchText.trim() ? current : { ...current, q: searchText.trim() }));
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchText]);

  const load = useCallback(async () => {
    const ticket = (latest.current += 1);
    setBusy(true);
    setError(null);
    try {
      const res = await storeFetch(`${base}/customers?${filterQuery(filters, { page, limit: CUSTOMER_PAGE_SIZE })}`, { cache: "no-store" });
      if (ticket !== latest.current) return;
      if (!res.ok) {
        setError(await problemOf(res, "The customers could not be loaded."));
        return;
      }
      setData((await res.json()) as CustomerList);
    } catch {
      if (ticket === latest.current) setError("Could not reach the server. Please try again.");
    } finally {
      if (ticket === latest.current) setBusy(false);
    }
  }, [base, filters, page, storeFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  function change(next: Partial<CustomerFilters>) {
    setFilters((current) => ({ ...current, ...next }));
    setPage(1);
  }

  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      const res = await storeFetch(`${base}/customers/export?${filterQuery(filters)}`, { cache: "no-store" });
      if (!res.ok) {
        setExportError(await problemOf(res, "The file could not be made."));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "customers.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError("Could not reach the server. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  const docs = data?.docs ?? [];
  const filtered = filters.q !== "" || filters.repeat || filters.hasEmail || filters.unsubscribed;

  return (
    <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-4 p-4 sm:p-6">
      <PageHeader title="Customers" description="Everyone who ordered from your store, grouped by phone number. Keep a private note on each." className="mb-0">
        <Button variant="clay-soft" className="min-h-11 w-full sm:w-auto" onClick={() => void exportCsv()} disabled={exporting} aria-busy={exporting}>
          {exporting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
          Export CSV
        </Button>
      </PageHeader>

      {exportError ? <FormAlert tone="error">{exportError}</FormAlert> : null}

      <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-3 sm:p-4">
        <div className="grid gap-1.5">
          <Label htmlFor="customer-search">Search</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="customer-search"
              className="h-11 pl-9"
              value={searchText}
              maxLength={80}
              placeholder="Name, phone or email"
              inputMode="search"
              autoComplete="off"
              onChange={(event) => setSearchText(event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
          {FILTER_CHIPS.map((chip) => (
            <button
              key={chip.key}
              type="button"
              aria-pressed={filters[chip.key]}
              onClick={() => change({ [chip.key]: !filters[chip.key] })}
              className={
                "inline-flex min-h-11 items-center rounded-full border px-4 text-sm " +
                (filters[chip.key] ? "border-primary bg-primary/10 font-medium text-foreground" : "border-border text-muted-foreground")
              }
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="grid gap-1.5 sm:max-w-xs">
          <Label htmlFor="customer-sort">Sort by</Label>
          <select
            id="customer-sort"
            className="h-11 w-full rounded-lg border bg-background px-3 text-sm"
            value={filters.sort}
            onChange={(event) => change({ sort: event.target.value as CustomerSortValue })}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <FormAlert tone="error">
          {error}{" "}
          <button type="button" className="font-medium underline" onClick={() => void load()}>
            Try again
          </button>
        </FormAlert>
      ) : null}

      {busy && data === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading customers…
        </p>
      ) : null}

      {data !== null && docs.length === 0 && !error ? (
        <EmptyState
          title={filtered ? "No customer matches" : "No customers yet"}
          description={filtered ? "Try another search or clear the filters." : "A customer appears here after their first order."}
          action={
            filtered ? (
              <Button
                variant="clay-soft"
                onClick={() => {
                  setSearchText("");
                  setFilters(DEFAULT_CUSTOMER_FILTERS);
                  setPage(1);
                }}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {docs.length > 0 ? (
        <>
          {/* 375 px first: one card per customer, nothing wider than the screen. */}
          <ul className="flex min-w-0 flex-col gap-3 md:hidden" aria-busy={busy}>
            {docs.map((customer) => (
              <li key={customer.id} className="min-w-0">
                <CustomerCard customer={customer} to={customerPath(storeBasePath(storeId), customer.id)} />
              </li>
            ))}
          </ul>

          <div className="hidden min-w-0 overflow-hidden rounded-2xl border border-border md:block" aria-busy={busy}>
            <table className="w-full table-fixed text-left text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="p-3">Customer</th>
                  <th className="w-24 p-3 text-right">Orders</th>
                  <th className="w-24 p-3 text-right">Delivered</th>
                  <th className="w-32 p-3 text-right">Total spent</th>
                  <th className="w-28 p-3">Last order</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((customer) => (
                  <tr key={customer.id} className="border-t border-border">
                    <td className="min-w-0 p-3">
                      <Link href={customerPath(storeBasePath(storeId), customer.id)} className="block min-w-0 font-medium underline-offset-4 hover:underline">
                        <span className="block truncate">{displayName(customer.name, customer.phone, customer.email)}</span>
                      </Link>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[displayPhone(customer.phone), customer.email].filter(Boolean).join(" · ")}
                        {customer.unsubscribed ? " · unsubscribed" : ""}
                      </span>
                      <TagList tags={customer.tags} />
                    </td>
                    <td className="p-3 text-right tabular-nums">{customer.orderCount}</td>
                    <td className="p-3 text-right tabular-nums">{customer.deliveredCount}</td>
                    <td className="p-3 text-right tabular-nums">{formatRs(customer.totalSpent)}</td>
                    <td className="p-3">{dateOf(customer.lastOrderAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {data?.totalDocs ?? 0} customer{data?.totalDocs === 1 ? "" : "s"}
              {data && data.totalPages > 1 ? ` · page ${data.page} of ${data.totalPages}` : ""}
            </p>
            {data && data.totalPages > 1 ? (
              <div className="flex w-full gap-2 sm:w-auto">
                <Button variant="outline" className="min-h-11 flex-1 sm:flex-none" disabled={page <= 1 || busy} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                  Previous
                </Button>
                <Button variant="outline" className="min-h-11 flex-1 sm:flex-none" disabled={page >= data.totalPages || busy} onClick={() => setPage((current) => current + 1)}>
                  Next
                </Button>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function TagList({ tags }: { tags: readonly string[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span key={tag} className="max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {tag}
        </span>
      ))}
    </span>
  );
}

function CustomerCard({ customer, to }: { customer: CustomerRow; to: string }) {
  return (
    <Link href={to} className="flex min-h-11 min-w-0 flex-col gap-1 rounded-2xl border border-border bg-card p-4 active:bg-muted/40">
      <span className="flex min-w-0 items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-medium">{displayName(customer.name, customer.phone, customer.email)}</span>
        <span className="shrink-0 text-sm font-medium tabular-nums">{formatRs(customer.totalSpent)}</span>
      </span>
      <span className="truncate text-sm text-muted-foreground">{[displayPhone(customer.phone), customer.email].filter(Boolean).join(" · ") || "No phone or email"}</span>
      <span className="text-xs text-muted-foreground">
        {customer.orderCount} order{customer.orderCount === 1 ? "" : "s"} · {customer.deliveredCount} delivered
        {customer.lastOrderAt ? ` · last ${dateOf(customer.lastOrderAt)}` : ""}
        {customer.unsubscribed ? " · unsubscribed" : ""}
      </span>
      <TagList tags={customer.tags} />
    </Link>
  );
}
