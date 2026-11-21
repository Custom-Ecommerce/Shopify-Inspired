"use client";

import React, { useEffect, useState } from "react";
import { useReturnRequest } from "@markaz/storefront-data/client";
import type { ReturnReasonCode } from "@markaz/storefront-data";

/*
 * Sprint 5 EP-13.US01.T04 (D-107, D-108): "Request a return" on the tracking page of a DELIVERED order. The Stiletto tracking answer has no
 * items (it is the parcel's journey only), so this asks the eligibility call for the returnable lines instead of widening that answer. The
 * order number and the phone are the ones the shopper typed to track the order: they are the credential and are kept in React state only.
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
      <section className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-900" role="status">
        <p className="font-bold uppercase tracking-wider">Return requested</p>
        <p className="mt-1">
          Your return number is <span className="font-mono font-bold">{request.created.returnNumber}</span>. The store will review it and contact you.
        </p>
      </section>
    );
  }

  if (!opened) {
    return (
      <div className="mt-5">
        <button
          type="button"
          onClick={() => setOpened(true)}
          className="h-11 w-full rounded-lg border border-black bg-white text-xs font-bold uppercase tracking-widest text-black hover:bg-gray-100"
        >
          Request a return
        </button>
      </div>
    );
  }

  const eligibility = request.eligibility;
  return (
    <section className="mt-5 rounded-xl border border-gray-200 p-4 text-xs" aria-label="Request a return">
      <h3 className="text-sm font-bold uppercase tracking-wider text-gray-800">Request a return</h3>
      {request.status === "loading" ? <p className="mt-2 text-gray-500">Checking what can be returned...</p> : null}
      {request.status === "not_found" ? <p className="mt-2 text-rose-700">We could not find this order. Please check the order number and phone.</p> : null}
      {request.status === "error" ? <p className="mt-2 text-rose-700">{request.message}</p> : null}
      {eligibility && !eligibility.eligible ? <p className="mt-2 text-gray-700">{INELIGIBLE[eligibility.reason ?? "nothing_left"]}</p> : null}

      {eligibility?.eligible ? (
        <form
          className="mt-3 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (items.length === 0) return;
            void request.submit({ orderId, phone, items, reasonCode, note: note.trim() === "" ? null : note.trim() });
          }}
        >
          <p className="text-gray-600">
            You can return items for {eligibility.windowDays} {eligibility.windowDays === 1 ? "day" : "days"} after delivery. Choose how many of each item.
          </p>
          <ul className="flex flex-col gap-2">
            {eligibility.lines
              .filter((line) => line.returnableQuantity > 0)
              .map((line) => {
                const id = "return-qty-" + keyOf(line);
                return (
                  <li key={keyOf(line)} className="flex items-center justify-between gap-3">
                    <label htmlFor={id} className="min-w-0 flex-1 break-words font-medium text-gray-800">
                      {line.productTitle}
                      {line.variantTitle && line.variantTitle !== "Default" ? " (" + line.variantTitle + ")" : ""}
                    </label>
                    <select
                      id={id}
                      className="h-11 rounded-lg border border-gray-300 bg-white px-2"
                      value={quantities[keyOf(line)] ?? 0}
                      onChange={(event) => setQuantities({ ...quantities, [keyOf(line)]: Number(event.target.value) })}
                    >
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
            <span className="font-bold uppercase tracking-wider text-gray-800">Reason</span>
            <select className="h-11 rounded-lg border border-gray-300 bg-white px-2" value={reasonCode} onChange={(event) => setReasonCode(event.target.value as ReturnReasonCode)}>
              {REASONS.map((reason) => (
                <option key={reason.value} value={reason.value}>
                  {reason.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-bold uppercase tracking-wider text-gray-800">Note (optional)</span>
            <textarea className="rounded-lg border border-gray-300 p-2" rows={3} maxLength={300} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          {request.message ? (
            <p role="alert" className="text-rose-700">
              {request.message}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={items.length === 0 || request.status === "submitting"}
            className="h-11 w-full rounded-lg bg-black text-xs font-bold uppercase tracking-widest text-white disabled:opacity-50"
          >
            {request.status === "submitting" ? "Sending..." : "Send return request"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
