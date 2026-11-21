"use client";

import { useEffect, useState } from "react";
import { useReturnRequest } from "@markaz/storefront-data/client";
import type { ReturnReasonCode } from "@markaz/storefront-data";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

/*
 * Sprint 5 EP-13.US01.T04 (D-107, D-108): "Request a return" on the tracking page of a DELIVERED order. The order number and the phone are the
 * ones the shopper typed to find the order; they are the credential, kept in React state only. Mustafa's tracking page already has the full
 * order, but the returnable QUANTITIES (delivered minus what is already asked for) and the window come from the eligibility call, so the form
 * uses that for both themes.
 */
const REASONS: ReadonlyArray<{ value: ReturnReasonCode; label: string }> = [
  { value: "damaged", label: "Damaged or defective" },
  { value: "wrong_item", label: "Wrong item received" },
  { value: "changed_mind", label: "Changed my mind" },
  { value: "other", label: "Other reason" },
];

const INELIGIBLE: Record<string, string> = {
  not_delivered: "This order has not been delivered yet.",
  window_closed: "The return period for this order has ended.",
  returns_off: "This store does not take returns.",
  card_order: "Returns of card orders are not available yet. Please contact the store.",
  nothing_left: "Every item of this order has already been returned or asked for.",
};

export function ReturnRequest({ orderId, phone }: { orderId: string; phone: string }) {
  const request = useReturnRequest();
  const { load } = request;
  const [opened, setOpened] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reasonCode, setReasonCode] = useState<ReturnReasonCode>("changed_mind");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (opened) void load(orderId, phone);
  }, [opened, load, orderId, phone]);

  const keyOf = (line: { productId: string; variantId: string }): string => line.productId + "|" + line.variantId;
  const items = (request.eligibility?.lines ?? [])
    .map((line) => ({ productId: line.productId, variantId: line.variantId, quantity: quantities[keyOf(line)] ?? 0 }))
    .filter((item) => item.quantity > 0);

  if (request.status === "done" && request.created) {
    return (
      <Alert role="status">
        <p className="font-semibold">Return requested</p>
        <p className="mt-1">
          Your return number is <span className="font-mono font-semibold">{request.created.returnNumber}</span>. The store will review it and contact you.
        </p>
      </Alert>
    );
  }

  if (!opened) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpened(true)}>
        Request a return
      </Button>
    );
  }

  const eligibility = request.eligibility;
  const fieldClass = "min-h-11 rounded-md border border-(--mu-border) bg-transparent px-3";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Request a return</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {request.status === "loading" ? <p className="text-(color:--mu-fg-muted)">Checking what can be returned...</p> : null}
        {request.status === "not_found" ? <p>We could not find this order. Check the order number and phone.</p> : null}
        {request.status === "error" ? <p role="alert">{request.message}</p> : null}
        {eligibility && !eligibility.eligible ? <p>{INELIGIBLE[eligibility.reason ?? "nothing_left"]}</p> : null}

        {eligibility?.eligible ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (items.length === 0) return;
              void request.submit({ orderId, phone, items, reasonCode, note: note.trim() === "" ? null : note.trim() });
            }}
          >
            <p className="text-(color:--mu-fg-muted)">
              You can return items for {eligibility.windowDays} {eligibility.windowDays === 1 ? "day" : "days"} after delivery. Choose how many of each item.
            </p>
            <ul className="flex flex-col gap-3">
              {eligibility.lines
                .filter((line) => line.returnableQuantity > 0)
                .map((line) => {
                  const id = "return-qty-" + keyOf(line);
                  return (
                    <li key={keyOf(line)} className="flex items-center justify-between gap-3">
                      <label htmlFor={id} className="min-w-0 flex-1 break-words">
                        {line.productTitle}
                        {line.variantTitle && line.variantTitle !== "Default" ? " (" + line.variantTitle + ")" : ""}
                      </label>
                      <select id={id} className={fieldClass} value={quantities[keyOf(line)] ?? 0} onChange={(event) => setQuantities({ ...quantities, [keyOf(line)]: Number(event.target.value) })}>
                        {Array.from({ length: line.returnableQuantity + 1 }, (_, count) => (
                          <option key={count} value={count}>
                            {count}
                          </option>
                        ))}
                      </select>
                    </li>
                  );
                })}
            </ul>
            <label className="flex flex-col gap-1">
              <span className="font-medium">Reason</span>
              <select className={fieldClass} value={reasonCode} onChange={(event) => setReasonCode(event.target.value as ReturnReasonCode)}>
                {REASONS.map((reason) => (
                  <option key={reason.value} value={reason.value}>
                    {reason.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium">Note (optional)</span>
              <textarea className="rounded-md border border-(--mu-border) bg-transparent p-3" rows={3} maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            {request.message ? <p role="alert">{request.message}</p> : null}
            <Button type="submit" disabled={items.length === 0 || request.status === "submitting"}>
              {request.status === "submitting" ? "Sending" : "Send return request"}
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
