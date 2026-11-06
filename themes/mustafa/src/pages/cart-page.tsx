"use client";

import Image from "next/image";
import Link from "next/link";
import { storePaths } from "@markaz/storefront-data";
import type { CartPageProps } from "@markaz/storefront-data";
import { useCart, useCartQuote } from "@markaz/storefront-data/client";
import type { CartQuoteLineVM } from "@markaz/storefront-data/client";
import { QtyStepper } from "../components/qty-stepper";
import { CartSkeleton } from "../components/skeletons";
import { StatusPanel } from "../components/status-panel";
import { Alert } from "../components/ui/alert";
import { Button, buttonVariants } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Spinner } from "../components/ui/spinner";
import { countLabel } from "../lib/text";

const shell = "mx-auto max-w-6xl px-4 pt-8 pb-16 sm:pt-12";

/** What the server says about a line, in the theme's own words. Null when the line can be bought. */
function issueCopy(issue: CartQuoteLineVM["issue"], availableQty: number | null): string | null {
  switch (issue) {
    case null:
      return null;
    case "unknown_product":
      return "No longer available. Remove it to continue.";
    case "out_of_stock":
      return "Out of stock. Remove it to continue.";
    case "insufficient_stock":
      return availableQty
        ? "Only " + availableQty + " left in stock. Remove it to continue."
        : "Out of stock. Remove it to continue.";
  }
}

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={
        strong
          ? "flex items-center justify-between border-t border-(--mu-border) pt-4 text-base"
          : "flex items-center justify-between text-sm"
      }
    >
      <span className="text-(color:--mu-fg-muted)">{label}</span>
      <span className={"tabular-nums " + (strong ? "font-semibold" : "font-medium")}>{value}</span>
    </div>
  );
}

export function CartPage(_props: CartPageProps) {
  const { lines, itemCount, subtotal, isEmpty, isHydrated, setQty, remove } = useCart();
  const quote = useCartQuote();
  const priced = quote.status === "ready" ? quote.quote : null;
  const pricedLines = new Map((priced?.lines ?? []).map((line) => [line.productId, line] as const));
  const blocked = priced !== null && !priced.canCheckout;

  if (!isHydrated) {
    return (
      <main className={shell}>
        <CartSkeleton />
      </main>
    );
  }

  if (isEmpty) {
    return (
      <StatusPanel
        title="Your cart is empty"
        action={
          <Link href={storePaths.catalog} className={buttonVariants({ size: "lg" })}>
            Continue shopping
          </Link>
        }
      >
        Products you add will appear here until you check out.
      </StatusPanel>
    );
  }

  return (
    <main className={shell}>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2 sm:mb-8">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Cart</h1>
        <p className="text-sm text-(color:--mu-fg-muted)">{countLabel(itemCount, "item", "items")}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem] md:gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="overflow-hidden">
          <ul className="divide-y divide-(--mu-border)">
            {lines.map((line) => {
              const state = pricedLines.get(line.productId);
              const issue = state ? issueCopy(state.issue, state.availableQty) : null;
              return (
                <li key={line.id} className="flex gap-4 p-4 sm:p-5">
                  <div className="relative size-20 shrink-0 overflow-hidden rounded-(--mu-radius) border border-(--mu-border) bg-(--mu-surface-muted) sm:size-24">
                    {line.image ? (
                      <Image src={line.image.url} alt="" fill sizes="96px" className="object-cover" />
                    ) : null}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Link
                      href={storePaths.product(line.slug)}
                      className="line-clamp-2 leading-snug font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--mu-focus)"
                    >
                      {line.title}
                    </Link>
                    <p className="text-sm tabular-nums text-(color:--mu-fg-muted)">
                      {line.unitPrice.formatted} &times; {line.qty}
                    </p>
                    {issue ? (
                      <p role="alert" className="mt-1 text-sm leading-relaxed text-(color:--mu-danger)">
                        {issue}
                      </p>
                    ) : null}
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-2">
                      <div className="flex items-center gap-3">
                        <QtyStepper label={line.title} qty={line.qty} onChange={(qty) => setQty(line.id, qty)} />
                        <Button variant="danger" size="sm" onClick={() => remove(line.id)}>
                          Remove
                        </Button>
                      </div>
                      <span className="font-semibold tabular-nums">{line.lineTotal.formatted}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <aside className="h-fit md:sticky md:top-24">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <SummaryRow label="Subtotal" value={(priced ? priced.subtotal : subtotal).formatted} />
              {priced ? <SummaryRow label="Delivery" value={priced.deliveryCharges.formatted} /> : null}
              {priced ? <SummaryRow label="Total" value={priced.total.formatted} strong /> : null}

              {quote.status === "loading" ? (
                <p role="status" className="flex items-center gap-2 text-sm text-(color:--mu-fg-muted)">
                  <Spinner />
                  Checking prices and stock
                </p>
              ) : null}
              {blocked ? (
                <Alert tone="danger" role="status">
                  <p>Remove the unavailable items to check out.</p>
                </Alert>
              ) : null}
              {quote.status === "unavailable" ? (
                <Alert tone="neutral">
                  <p>We could not check stock just now. Checkout confirms your order before it is placed.</p>
                </Alert>
              ) : null}

              <div className="pt-2">
                {blocked ? (
                  <Button size="lg" fullWidth disabled>
                    Proceed to checkout
                  </Button>
                ) : (
                  <Link href={storePaths.checkout} className={buttonVariants({ size: "lg", fullWidth: true })}>
                    Proceed to checkout
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}
