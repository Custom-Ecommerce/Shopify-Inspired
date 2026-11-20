"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageCircle, Trash2 } from "lucide-react";
import type { AbandonedCartList, SellerAbandonedCart } from "@markaz/contracts";
import { whatsappLink } from "@markaz/notifications/whatsapp";
import { FormAlert } from "@/components/auth/AccountCard";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { StatusBadge } from "@/components/dashboard/shared/StatusBadge";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";
import { Button, buttonVariants } from "@/components/ui/button";
import { useActiveStoreId, useDashboard } from "@/lib/dashboard-context";
import { CART_TABS, cartErrorText, cartListQuery, cartWhatsappText, itemLine, minutesAgoText, type CartTab } from "@/lib/abandoned-carts-view";
import { displayPhone } from "@/lib/customer-view";
import { formatRs } from "@/lib/format";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";

/**
 * Sprint 5 EP-28.US01.T04 (D-107): the carts shoppers left in this store, WhatsApp first. Each card shows the items and their value, how long ago
 * the shopper was there, and a button that opens wa.me with a prefilled message (no API: the seller sends it from their own phone). A cart
 * is kept only when the shopper gave a valid phone and agreed to be messaged, and it disappears after 7 days. 375 px first: one column of
 * cards, full-width 44 px buttons.
 */
export default function AbandonedCartsPage() {
  const storeId = useActiveStoreId();
  const { activeStore } = useDashboard();
  const storeFetch = useStoreFetch();
  const base = `/api/proxy/stores/${encodeURIComponent(storeId)}/abandoned-carts`;
  const [tab, setTab] = useState<CartTab>("open");
  const [page, setPage] = useState(1);
  const [list, setList] = useState<AbandonedCartList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await storeFetch(`${base}?${cartListQuery(tab, page)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("not ok");
      setList((await res.json()) as AbandonedCartList);
    } catch {
      setError("Could not load the carts. Please try again.");
    }
  }, [base, page, storeFetch, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(cart: SellerAbandonedCart, run: () => Promise<Response>, done: string) {
    setBusyId(cart.id);
    setNotice(null);
    setError(null);
    try {
      const res = await run();
      if (!res.ok) {
        setError(cartErrorText(await res.json().catch(() => null)));
        return;
      }
      setNotice(done);
      await load();
    } catch {
      setError("Could not reach the backend. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  const markContacted = (cart: SellerAbandonedCart) =>
    act(
      cart,
      () => storeFetch(`${base}/${encodeURIComponent(cart.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "contacted" }) }),
      "Marked as contacted.",
    );
  const remove = (cart: SellerAbandonedCart) => act(cart, () => storeFetch(`${base}/${encodeURIComponent(cart.id)}`, { method: "DELETE" }), "Cart removed.");

  return (
    <div className="p-6 sm:p-8">
      <PageHeader title="Abandoned carts" />
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
        Shoppers who typed their phone number and agreed to be messaged, but did not order. Message them on WhatsApp. A cart disappears after 7 days.
        {list ? ` ${list.openCount} open.` : ""}
      </p>

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Cart status">
        {CART_TABS.map((entry) => (
          <Button
            key={entry.value}
            type="button"
            role="tab"
            aria-selected={tab === entry.value}
            variant={tab === entry.value ? "default" : "outline"}
            className="min-h-11"
            onClick={() => {
              setTab(entry.value);
              setPage(1);
            }}
          >
            {entry.label}
          </Button>
        ))}
      </div>

      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      {notice ? <FormAlert tone="success">{notice}</FormAlert> : null}

      {list === null && !error ? (
        <p className="text-sm text-muted-foreground" role="status">
          <Loader2 className="mr-1 inline size-4 animate-spin" aria-hidden="true" /> Loading...
        </p>
      ) : null}
      {list && list.docs.length === 0 ? <EmptyState title="No carts here" description="When a shopper leaves a cart after giving their phone, it appears here." /> : null}

      <div className="grid gap-4 md:grid-cols-2">
        {list?.docs.map((cart) => {
          const wa = whatsappLink(cart.phone, cartWhatsappText(activeStore.name, cart.items));
          const busy = busyId === cart.id;
          return (
            <article key={cart.id} className="rounded-xl border bg-card p-4 text-card-foreground" aria-label={`Cart of ${displayPhone(cart.phone)}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-base font-semibold">{formatRs(cart.total)}</span>
                <StatusBadge status={cart.status === "open" ? "pending" : cart.status === "contacted" ? "confirmed" : "completed"} label={cart.status === "open" ? "Open" : cart.status === "contacted" ? "Contacted" : "Recovered"} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {minutesAgoText(cart.lastSeenAt)} · {displayPhone(cart.phone)}
              </p>
              <ul className="mt-3 flex flex-col gap-1 text-sm">
                {cart.items.map((item) => (
                  <li key={item.productId + "|" + item.variantId} className="flex justify-between gap-3">
                    <span className="min-w-0 break-words">{itemLine(item)}</span>
                    <span className="shrink-0 text-muted-foreground">{formatRs(item.unitPrice * item.quantity)}</span>
                  </li>
                ))}
              </ul>
              {cart.status === "recovered" ? <p className="mt-3 text-sm text-success">The shopper placed an order.</p> : null}
              {cart.status === "contacted" && cart.contactedAt ? <p className="mt-3 text-xs text-muted-foreground">Contacted {minutesAgoText(cart.contactedAt)}.</p> : null}

              {cart.status !== "recovered" ? (
                <div className="mt-3 flex flex-col gap-2">
                  {wa ? (
                    <a
                      href={wa}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${buttonVariants({ variant: "default" })} min-h-11 w-full gap-2`}
                      onClick={() => {
                        // Opening the chat marks the cart contacted (best effort: the page reloads the list when it answers).
                        if (cart.status === "open") void markContacted(cart);
                      }}
                    >
                      <MessageCircle className="size-4" aria-hidden="true" /> Message on WhatsApp
                    </a>
                  ) : null}
                  {cart.status === "open" ? (
                    <Button type="button" variant="outline" className="min-h-11 w-full" disabled={busy} onClick={() => void markContacted(cart)}>
                      Mark as contacted
                    </Button>
                  ) : null}
                </div>
              ) : null}
              <Button type="button" variant="ghost" size="sm" className="mt-2 min-h-11 w-full text-muted-foreground" disabled={busy} onClick={() => void remove(cart)}>
                <Trash2 className="size-4" aria-hidden="true" /> Remove
              </Button>
            </article>
          );
        })}
      </div>

      {list && list.totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button type="button" variant="outline" className="min-h-11" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {list.page} of {list.totalPages}
          </span>
          <Button type="button" variant="outline" className="min-h-11" disabled={page >= list.totalPages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
