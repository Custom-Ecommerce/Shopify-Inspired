"use client";

import { toMoney } from "@markaz/storefront-data";
import type { OrderTrackingPageProps, StorefrontOrder } from "@markaz/storefront-data";
import { useOrderLookup } from "@markaz/storefront-data/client";
import type { OrderLookupFailure, UseOrderLookupResult } from "@markaz/storefront-data/client";
import { Alert } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Field, fieldDescribedBy } from "../components/ui/field";
import { Input } from "../components/ui/input";
import { ORDER_STATUS_STEPS, PAYMENT_LABELS, orderStatusCopy } from "../lib/order-status";

const ORDER_FIELD = "track-order-id";
const PHONE_FIELD = "track-phone";
const ORDER_HINT = "Found on your confirmation, for example ORD-XXXXXXXX.";
const PHONE_HINT = "The mobile number you gave when you placed the order.";

/**
 * Order tracking. The shopper gives the order reference and the phone number the order was placed with. The lookup goes
 * through the store's own same-origin BFF, and the server matches both before it returns anything.
 */
export function OrderTrackingPage({ orderId }: OrderTrackingPageProps) {
  const lookup = useOrderLookup(orderId ?? "");
  const searching = lookup.status === "searching";
  const orderError = lookup.errors.orderId ?? null;
  const phoneError = lookup.errors.phone ?? null;

  return (
    <main className="mx-auto max-w-2xl px-4 pt-6 pb-16 sm:pt-10">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Track your order</h1>
      <p className="mt-2 leading-relaxed text-(color:--mu-fg-muted)">
        Enter the order reference from your confirmation and the mobile number you placed the order with.
      </p>

      <Card className="mt-6">
        <CardContent>
          <form
            noValidate
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              void lookup.submit();
            }}
          >
            <Field id={ORDER_FIELD} label="Order reference" hint={ORDER_HINT} error={orderError}>
              <Input
                id={ORDER_FIELD}
                name="orderId"
                value={lookup.values.orderId}
                onChange={(event) => lookup.setField("orderId", event.target.value)}
                placeholder="ORD-XXXXXXXX"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-invalid={orderError ? true : undefined}
                aria-describedby={fieldDescribedBy(ORDER_FIELD, ORDER_HINT, orderError)}
              />
            </Field>

            <Field id={PHONE_FIELD} label="Mobile number" hint={PHONE_HINT} error={phoneError}>
              <Input
                id={PHONE_FIELD}
                name="phone"
                type="tel"
                inputMode="tel"
                value={lookup.values.phone}
                onChange={(event) => lookup.setField("phone", event.target.value)}
                placeholder="03xx xxxxxxx"
                autoComplete="tel"
                aria-invalid={phoneError ? true : undefined}
                aria-describedby={fieldDescribedBy(PHONE_FIELD, PHONE_HINT, phoneError)}
              />
            </Field>

            <Button type="submit" size="lg" fullWidth loading={searching}>
              {searching ? "Checking your order" : "Track order"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div aria-live="polite" className="mt-6">
        <LookupOutcome lookup={lookup} />
      </div>
    </main>
  );
}

function LookupOutcome({ lookup }: { lookup: UseOrderLookupResult }) {
  if (lookup.status === "found" && lookup.order) return <OrderDetails order={lookup.order} />;
  if (lookup.status === "not_found") {
    return (
      <Alert tone="danger">
        <p>No order matches that reference and mobile number. Check both and try again.</p>
      </Alert>
    );
  }
  if (lookup.status === "error") {
    return (
      <Alert tone="danger">
        <p>{failureMessage(lookup.failure)}</p>
      </Alert>
    );
  }
  return null;
}

function failureMessage(failure: OrderLookupFailure | null): string {
  if (failure?.kind === "rate_limited") {
    return failure.retryAfterSeconds
      ? "Too many attempts. Please wait " + failure.retryAfterSeconds + " seconds and try again."
      : "Too many attempts. Please wait a moment and try again.";
  }
  return "We could not look up your order right now. Please try again shortly.";
}

function OrderDetails({ order }: { order: StorefrontOrder }) {
  const copy = orderStatusCopy(order.status);
  const stepIndex = ORDER_STATUS_STEPS.findIndex((step) => step.status === order.status);
  const placed = new Date(order.createdAt).toLocaleDateString("en-PK", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const money = (amount: number) => toMoney(amount).formatted;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-(color:--mu-fg-muted)">Order reference</p>
            <CardTitle className="break-all tabular-nums">{order.orderId}</CardTitle>
          </div>
          <Badge tone={copy.tone}>{copy.label}</Badge>
        </div>
        <p className="mt-2 text-sm text-(color:--mu-fg-muted)">Placed on {placed}</p>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <p className="leading-relaxed">{copy.description}</p>

        {stepIndex >= 0 ? (
          <ol aria-label="Order progress" className="flex gap-1.5">
            {ORDER_STATUS_STEPS.map((step, index) => {
              const reached = index <= stepIndex;
              return (
                <li
                  key={step.status}
                  aria-current={index === stepIndex ? "step" : undefined}
                  className="flex min-w-0 flex-1 flex-col gap-2"
                >
                  <span
                    aria-hidden="true"
                    className={"h-1.5 w-full rounded-full " + (reached ? "bg-(--mu-primary)" : "bg-(--mu-border)")}
                  />
                  <span
                    className={
                      "text-center text-[11px] leading-tight sm:text-xs " +
                      (reached ? "font-medium text-(color:--mu-fg)" : "text-(color:--mu-fg-muted)")
                    }
                  >
                    {step.label}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : null}

        <section aria-labelledby="order-items-heading" className="flex flex-col gap-3">
          <h3 id="order-items-heading" className="text-sm font-semibold">
            Items
          </h3>
          <ul className="divide-y divide-(--mu-border)">
            {order.items.map((item) => (
              <li key={item.productId} className="flex items-start justify-between gap-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{item.title}</span>
                  <span className="block text-(color:--mu-fg-muted) tabular-nums">
                    {money(item.unitPrice)} &times; {item.qty}
                  </span>
                </span>
                <span className="font-semibold tabular-nums">{money(item.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <dl className="flex flex-col gap-2 border-t border-(--mu-border) pt-4 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-(color:--mu-fg-muted)">Subtotal</dt>
              <dd className="tabular-nums">{money(order.subtotal)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-(color:--mu-fg-muted)">Delivery</dt>
              <dd className="tabular-nums">{order.deliveryCharges > 0 ? money(order.deliveryCharges) : "Free"}</dd>
            </div>
            {order.discount > 0 ? (
              <div className="flex items-center justify-between">
                <dt className="text-(color:--mu-fg-muted)">Discount</dt>
                <dd className="tabular-nums">-{money(order.discount)}</dd>
              </div>
            ) : null}
            <div className="flex items-center justify-between pt-2 text-base">
              <dt className="font-semibold">Total</dt>
              <dd className="font-semibold tabular-nums">{money(order.total)}</dd>
            </div>
          </dl>
        </section>

        <section className="grid gap-4 text-sm sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <h3 className="font-semibold">Delivery to</h3>
            <p className="leading-relaxed text-(color:--mu-fg-muted)">{order.customerName}</p>
            <p className="leading-relaxed text-(color:--mu-fg-muted)">
              {order.address}
              {order.city ? ", " + order.city : ""}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="font-semibold">Payment</h3>
            <p className="text-(color:--mu-fg-muted)">{PAYMENT_LABELS[order.paymentMethod]}</p>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
