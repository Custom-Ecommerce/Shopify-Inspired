"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DashboardOrderDetail } from "@markaz/contracts";
import { addressInsights, customerPath, type AddressEntryView } from "@/lib/customer-view";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { storeHref } from "@/lib/store-routes";

/**
 * Sprint 5 EP-10.US03.T02 (D-107): on the seller's order page, "Same address as an earlier order" and the customer's other addresses with
 * a link to the customer page. Seller side only: nothing is prefilled on the storefront. The book is read quietly; when it cannot be
 * read, or the order has no customer key, nothing is shown (the order page never depends on it).
 */
export function EarlierAddresses({ storeId, order }: { storeId: string; order: DashboardOrderDetail }) {
  const storeFetch = useStoreFetch();
  const key = order.customerKey ?? null;
  const [entries, setEntries] = useState<AddressEntryView[] | null>(null);

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await storeFetch(`/api/proxy/stores/${encodeURIComponent(storeId)}/customers/${encodeURIComponent(key)}/addresses`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { addresses?: AddressEntryView[] };
        if (!cancelled && Array.isArray(data.addresses)) setEntries(data.addresses);
      } catch {
        // Nothing is shown.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, storeFetch, storeId, order.id]);

  if (key === null || entries === null) return null;
  const { repeat, others } = addressInsights(entries, order.address, order.city);
  if (!repeat && others.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-xl border bg-muted/40 p-3" data-slot="earlier-addresses">
      {repeat ? <p className="font-medium">Same address as an earlier order</p> : null}
      {others.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">Other addresses of this customer</p>
          <ul className="flex flex-col gap-1">
            {others.map((entry) => (
              <li key={entry.address + "|" + (entry.city ?? "")} className="break-words">
                {entry.address}
                {entry.city ? <span className="text-muted-foreground">, {entry.city}</span> : null}
                <span className="text-xs text-muted-foreground"> · {entry.orderCount} {entry.orderCount === 1 ? "order" : "orders"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Link href={customerPath(storeHref(storeId), key)} className="inline-flex min-h-11 w-fit items-center text-sm font-medium underline-offset-4 hover:underline">
        View customer
      </Link>
    </div>
  );
}
