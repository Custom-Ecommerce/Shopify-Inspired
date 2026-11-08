"use client";

import type { OrderPrintResponse, OrderPrintSheet } from "@markaz/contracts";
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { storeHref } from "@/lib/store-routes";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/dashboard/shared/ErrorState";

// EP-02 OB-5b: shipping labels (A6) and packing slips (A4), for one order or up to 50. On screen the sheets are paper-like
// cards; when printing, the dashboard shell and every control disappear and each order takes its own page.

type PrintMode = "label" | "slip";

type LoadState = { kind: "loading" } | { kind: "error" } | { kind: "ready"; data: OrderPrintResponse };

const SKIP_WORDS: Record<OrderPrintResponse["skipped"][number]["reason"], string> = {
  not_found: "not found",
  cancelled: "cancelled",
  returned: "returned",
};

const money = (amount: number): string => `Rs. ${amount.toLocaleString()}`;

const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Karachi" });

const totalQty = (order: OrderPrintSheet): number => order.items.reduce((sum, item) => sum + item.qty, 0);

const fullAddress = (order: OrderPrintSheet): string => [order.address, order.city].filter(Boolean).join(", ");

/** Long text takes a smaller size, so a label still fits one A6 page. Nothing is ever cut. */
function sizeClass(length: number, large: number, medium: number, small: number): string {
  if (length <= large) return "ps-text-lg";
  if (length <= medium) return "ps-text-md";
  if (length <= small) return "ps-text-sm";
  return "ps-text-xs";
}

function pageStyles(mode: PrintMode): string {
  return `
.ps-sheet { background: #fff; color: #000; box-sizing: border-box; overflow-wrap: anywhere; box-shadow: 0 1px 6px rgb(0 0 0 / 0.25); }
.ps-sheet * { border-color: #000; }
.ps-label { width: 105mm; max-width: 100%; min-height: 148mm; padding: 5mm; display: flex; flex-direction: column; gap: 2.5mm; font-size: 10pt; line-height: 1.25; }
.ps-slip { width: 210mm; min-height: 297mm; padding: 12mm; display: flex; flex-direction: column; gap: 5mm; font-size: 11pt; line-height: 1.3; }
.ps-row { display: flex; justify-content: space-between; gap: 3mm; }
.ps-store { font-weight: 700; font-size: 12pt; }
.ps-muted { font-size: 8.5pt; }
.ps-section { border-top: 0.3mm solid #000; padding-top: 2mm; }
.ps-caption { font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
.ps-strong { font-weight: 700; }
.ps-text-lg { font-size: 12pt; }
.ps-text-md { font-size: 10pt; }
.ps-text-sm { font-size: 8.5pt; }
.ps-text-xs { font-size: 7pt; }
.ps-cod { border: 0.6mm solid #000; text-align: center; padding: 2mm; font-weight: 800; font-size: 22pt; line-height: 1.1; }
.ps-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.ps-table th, .ps-table td { border: 0.25mm solid #000; padding: 1.5mm 2mm; text-align: left; vertical-align: top; }
.ps-table tr { break-inside: avoid; }
.ps-notes { border: 0.3mm solid #000; min-height: 35mm; padding: 2mm; }
.ps-scroll { overflow-x: auto; max-width: 100%; }

@page { size: ${mode === "label" ? "A6" : "A4"}; margin: 0; }

@media print {
  html, body { background: #fff !important; }
  [data-slot="sidebar"], [data-slot="sidebar-gap"], [data-slot="sidebar-container"], [data-slot="sidebar-rail"], header, div[role="alert"].fixed, .ps-no-print { display: none !important; }
  /* Page breaks are ignored inside flex containers, so everything around the sheets becomes a plain block. */
  [data-slot="sidebar-wrapper"], [data-slot="sidebar-inset"], [data-slot="sidebar-inset"] > div, .ps-root, .ps-stack, .ps-page, .ps-scroll {
    display: block !important; min-height: 0 !important; height: auto !important; width: auto !important; max-width: none !important;
    margin: 0 !important; padding: 0 !important; overflow: visible !important; background: #fff !important;
  }
  .ps-page { break-after: page; }
  .ps-page:last-child { break-after: auto; }
  .ps-sheet { box-shadow: none; max-width: none; min-height: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .ps-label { width: 105mm; break-inside: avoid; }
  .ps-slip { width: 210mm; }
}
`;
}

function ShippingLabel({ order, storeName }: { order: OrderPrintSheet; storeName: string }) {
  const address = fullAddress(order);
  const hasCourier = Boolean(order.courier || order.trackingNumber);
  return (
    <article className="ps-sheet ps-label">
      <div>
        <div className="ps-store" dir="auto">{storeName}</div>
        <div className="ps-row ps-muted">
          <span className="ps-strong">{order.orderId}</span>
          <span>{shortDate(order.createdAt)}</span>
        </div>
      </div>

      <div className="ps-section">
        <div className="ps-caption">Ship to</div>
        <div className={`ps-strong ${sizeClass((order.customerName ?? "").length, 40, 90, 160)}`} dir="auto">{order.customerName ?? "—"}</div>
        {order.phone ? <div className="ps-text-md ps-strong" dir="ltr">{order.phone}</div> : null}
        <div className={sizeClass(address.length, 90, 200, 340)} dir="auto">{address || "—"}</div>
      </div>

      <div className="ps-cod">{order.codAmount > 0 ? `COD ${money(order.codAmount)}` : "PREPAID / PAID"}</div>

      <div className="ps-section">
        <div className="ps-caption">Courier</div>
        {hasCourier ? (
          <>
            {order.courier ? <div className="ps-strong" dir="auto">{order.courier}</div> : null}
            {order.trackingNumber ? <div dir="ltr">{order.trackingNumber}</div> : null}
          </>
        ) : (
          <div>Courier not set yet</div>
        )}
      </div>

      <div className="ps-section ps-strong">Items: {totalQty(order)}</div>
    </article>
  );
}

function PackingSlip({ order, storeName }: { order: OrderPrintSheet; storeName: string }) {
  return (
    <article className="ps-sheet ps-slip">
      <div className="ps-row">
        <div>
          <div className="ps-store" dir="auto">{storeName}</div>
          <div className="ps-strong">Packing slip</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div className="ps-strong">{order.orderId}</div>
          <div>{shortDate(order.createdAt)}</div>
        </div>
      </div>

      <div className="ps-section">
        <div className="ps-caption">Customer</div>
        <div className="ps-strong" dir="auto">{order.customerName ?? "—"}</div>
        {order.phone ? <div dir="ltr">{order.phone}</div> : null}
        <div dir="auto">{fullAddress(order) || "—"}</div>
      </div>

      <table className="ps-table">
        <colgroup>
          <col style={{ width: "48%" }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "10%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>Item</th>
            <th>Variant</th>
            <th>SKU</th>
            <th>Qty</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item, index) => (
            <tr key={index}>
              <td dir="auto">{item.title}</td>
              <td dir="auto">{item.variantTitle ?? "—"}</td>
              <td>{item.sku ?? "—"}</td>
              <td>{item.qty}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="ps-row ps-strong">
        <span>Total quantity: {totalQty(order)}</span>
        <span>{order.codAmount > 0 ? `COD to collect: ${money(order.codAmount)}` : "Nothing to collect"}</span>
      </div>

      <div>
        <div className="ps-caption">Notes</div>
        <div className="ps-notes" />
      </div>
    </article>
  );
}

function skippedText(skipped: OrderPrintResponse["skipped"]): string {
  const reasons = [...new Set(skipped.map((entry) => SKIP_WORDS[entry.reason]))].join(", ");
  return `${skipped.length} order${skipped.length === 1 ? "" : "s"} not printed: ${reasons}`;
}

function PrintContent() {
  const storeFetch = useStoreFetch();
  const params = useParams<{ storeId: string }>();
  const search = useSearchParams();
  const ids = search.get("ids") ?? "";
  const mode: PrintMode = search.get("mode") === "slip" ? "slip" : "label";
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const load = useCallback(() => {
    if (ids === "") {
      setState({ kind: "error" });
      return;
    }
    setState({ kind: "loading" });
    storeFetch(`/api/dashboard/orders/print?ids=${encodeURIComponent(ids)}`, { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as OrderPrintResponse | null;
        setState(res.ok && data?.orders ? { kind: "ready", data } : { kind: "error" });
      })
      .catch(() => setState({ kind: "error" }));
  }, [ids, storeFetch]);

  useEffect(load, [load]);

  const orders = state.kind === "ready" ? state.data.orders : [];

  return (
    <div className="ps-root flex min-w-0 flex-col gap-4 p-4 sm:p-8">
      {/* Raw on purpose: React would escape > and " in text children. The CSS is fixed; only the page size varies, from a closed set. */}
      <style dangerouslySetInnerHTML={{ __html: pageStyles(mode) }} />

      <div className="ps-no-print flex flex-wrap items-center gap-2">
        <Button variant="clay" className="h-11 sm:h-9" disabled={orders.length === 0} onClick={() => window.print()}>
          Print
        </Button>
        <Button variant="clay-soft" className="h-11 sm:h-9" render={<Link href={storeHref(params.storeId, "/orders")} />}>
          Back
        </Button>
        <span className="text-sm text-muted-foreground">
          {state.kind === "ready" ? `${orders.length} ${mode === "label" ? "shipping label" : "packing slip"}${orders.length === 1 ? "" : "s"}` : null}
        </span>
      </div>

      {state.kind === "loading" ? (
        <div className="ps-no-print flex flex-col gap-4" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-96 w-full max-w-md rounded-lg" />
        </div>
      ) : null}

      {state.kind === "error" ? (
        <div className="ps-no-print">
          <ErrorState message={ids === "" ? "No orders were chosen to print." : "Could not load these orders."} onRetry={ids === "" ? undefined : load} />
        </div>
      ) : null}

      {state.kind === "ready" && state.data.skipped.length > 0 ? (
        <p className="ps-no-print rounded-xl border bg-muted/40 p-3 text-sm">{skippedText(state.data.skipped)}</p>
      ) : null}

      {state.kind === "ready" ? (
        <div className="ps-stack flex min-w-0 flex-col gap-4">
          {orders.map((order) => (
            <div key={order.id} className="ps-page">
              <div className="ps-scroll">
                {mode === "label" ? (
                  <ShippingLabel order={order} storeName={state.data.store.name} />
                ) : (
                  <PackingSlip order={order} storeName={state.data.store.name} />
                )}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function OrderPrintPage() {
  return (
    <Suspense fallback={null}>
      <PrintContent />
    </Suspense>
  );
}
