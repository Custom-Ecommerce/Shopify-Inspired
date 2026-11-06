"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { storePaths } from "@markaz/storefront-data";
import type { CheckoutPageProps } from "@markaz/storefront-data";
import { useCheckout } from "@markaz/storefront-data/client";
import type { CheckoutFailure } from "@markaz/storefront-data/client";
import { CheckoutSkeleton } from "../components/skeletons";
import { StatusPanel } from "../components/status-panel";
import { Alert, AlertTitle } from "../components/ui/alert";
import { Button, buttonVariants } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Field, fieldDescribedBy } from "../components/ui/field";
import { Input, Textarea } from "../components/ui/input";
import { Spinner } from "../components/ui/spinner";
import { failureCopy, isCartItemFailure, parseServerFieldError } from "../lib/checkout-messages";
import type { CheckoutFormField } from "../lib/checkout-messages";

const shell = "mx-auto max-w-5xl px-4 pt-6 pb-16 sm:pt-10";

interface FormFieldSpec {
  name: CheckoutFormField;
  label: string;
  placeholder: string;
  autoComplete: string;
  type: "text" | "tel";
  multiline: boolean;
  hint?: string;
}

const FIELDS: FormFieldSpec[] = [
  {
    name: "customerName",
    label: "Full name",
    placeholder: "Your full name",
    autoComplete: "name",
    type: "text",
    multiline: false,
  },
  {
    name: "phone",
    label: "Mobile number",
    placeholder: "03xx xxxxxxx",
    autoComplete: "tel",
    type: "tel",
    multiline: false,
    hint: "You will need this number to track your order.",
  },
  {
    name: "address",
    label: "Delivery address",
    placeholder: "House, street, area, city",
    autoComplete: "street-address",
    type: "text",
    multiline: true,
  },
];

export function CheckoutPage(_props: CheckoutPageProps) {
  const router = useRouter();
  const checkout = useCheckout();
  const { orderId } = checkout;
  const [submitCount, setSubmitCount] = useState(0);
  const [dismissedFailure, setDismissedFailure] = useState<CheckoutFailure | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (orderId) router.push(storePaths.order(orderId));
  }, [orderId, router]);

  // After each submit, move focus to the error summary when there is one, so keyboard and screen reader
  // users land on the problem rather than on the button they just pressed.
  useEffect(() => {
    if (submitCount > 0) summaryRef.current?.focus();
  }, [submitCount, checkout.failure]);

  const failure = checkout.failure;
  const serverField = failure ? parseServerFieldError(failure) : null;
  // A server message about a field stops showing once the shopper edits that field, or once a newer failure replaces it.
  const liveServerField = serverField !== null && failure !== dismissedFailure ? serverField : null;
  // Anything the server did not tie to one of the form's fields shows as a banner.
  const bannerFailure = failure !== null && serverField === null ? failure : null;

  function errorFor(name: CheckoutFormField): string | null {
    const clientError = checkout.errors[name];
    if (clientError) return clientError;
    if (liveServerField && liveServerField.field === name) return liveServerField.message;
    return null;
  }

  function updateField(name: CheckoutFormField, value: string) {
    checkout.setField(name, value);
    if (liveServerField && liveServerField.field === name) setDismissedFailure(failure);
  }

  if (!checkout.isCartReady) {
    return (
      <main className={shell}>
        <CheckoutSkeleton />
      </main>
    );
  }

  if (checkout.status === "success") {
    return (
      <StatusPanel title="Order placed" icon={<Spinner className="size-7 text-(color:--mu-primary)" />}>
        <span role="status">Taking you to your confirmation.</span>
      </StatusPanel>
    );
  }

  if (checkout.isCartEmpty) {
    return (
      <StatusPanel
        title="Your cart is empty"
        action={
          <Link href={storePaths.catalog} className={buttonVariants({ size: "lg" })}>
            Continue shopping
          </Link>
        }
      >
        Add a product to your cart before you check out.
      </StatusPanel>
    );
  }

  const submitting = checkout.status === "submitting";
  const issues = FIELDS.flatMap((field) => {
    const message = errorFor(field.name);
    return message ? [{ name: field.name, label: field.label, message }] : [];
  });

  return (
    <main className={shell}>
      <h1 className="mb-6 text-3xl font-semibold tracking-tight sm:mb-8 sm:text-4xl">Checkout</h1>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_21rem] md:gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>Your details</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              noValidate
              className="flex flex-col gap-5"
              onSubmit={(event) => {
                event.preventDefault();
                setSubmitCount((count) => count + 1);
                void checkout.submit();
              }}
            >
              {submitCount > 0 && issues.length > 0 ? (
                <div ref={summaryRef} tabIndex={-1} className="focus:outline-none">
                  <Alert tone="danger">
                    <AlertTitle>Please check your details</AlertTitle>
                    <ul className="space-y-1">
                      {issues.map((issue) => (
                        <li key={issue.name}>
                          <a
                            href={"#checkout-" + issue.name}
                            className="font-medium underline underline-offset-4"
                          >
                            {issue.label}
                          </a>
                          {": " + issue.message}
                        </li>
                      ))}
                    </ul>
                  </Alert>
                </div>
              ) : null}

              {FIELDS.map((field) => {
                const id = "checkout-" + field.name;
                const error = errorFor(field.name);
                const shared = {
                  id,
                  name: field.name,
                  value: checkout.values[field.name],
                  autoComplete: field.autoComplete,
                  placeholder: field.placeholder,
                  "aria-invalid": error ? true : undefined,
                  "aria-describedby": fieldDescribedBy(id, field.hint, error),
                };
                return (
                  <Field key={field.name} id={id} label={field.label} hint={field.hint} error={error}>
                    {field.multiline ? (
                      <Textarea
                        {...shared}
                        rows={3}
                        onChange={(event) => updateField(field.name, event.target.value)}
                      />
                    ) : (
                      <Input
                        {...shared}
                        type={field.type}
                        onChange={(event) => updateField(field.name, event.target.value)}
                      />
                    )}
                  </Field>
                );
              })}

              {bannerFailure ? (
                <Alert tone="danger">
                  <p>{failureCopy(bannerFailure)}</p>
                  {isCartItemFailure(bannerFailure) ? (
                    <Link href={storePaths.cart} className="font-medium underline underline-offset-4">
                      Review your cart
                    </Link>
                  ) : null}
                </Alert>
              ) : null}

              <Button type="submit" size="lg" fullWidth loading={submitting}>
                {submitting ? "Placing order…" : "Place order"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="h-fit md:sticky md:top-24">
          <CardHeader>
            <CardTitle>Order summary</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ul className="divide-y divide-(--mu-border)">
              {checkout.lines.map((line) => (
                <li key={line.id} className="flex items-start justify-between gap-3 py-3 text-sm first:pt-0 last:pb-0">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{line.title}</span>
                    <span className="text-(color:--mu-fg-muted) tabular-nums">
                      {line.unitPrice.formatted} &times; {line.qty}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">{line.lineTotal.formatted}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-(--mu-border) pt-4 text-sm">
              <span className="text-(color:--mu-fg-muted)">Subtotal</span>
              <span className="font-semibold tabular-nums">{checkout.subtotal.formatted}</span>
            </div>
            <p className="text-sm leading-relaxed text-(color:--mu-fg-muted)">
              The final total, including delivery, is confirmed when you place the order.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
