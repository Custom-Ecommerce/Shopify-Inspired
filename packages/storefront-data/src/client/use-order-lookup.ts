"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { EMPTY_ORDER_LOOKUP_VALUES, validateOrderLookup } from "../domain/order-lookup";
import type { OrderLookupField, OrderLookupFieldErrors, OrderLookupValues } from "../domain/order-lookup";
import { OrderRejectedError } from "../transport/errors";
import type { StorefrontOrder } from "../transport/types";
import { useOrderTransport } from "./context";

/** "editing" before the first attempt. "not_found" is an answer, not a failure. */
export type OrderLookupStatus = "editing" | "searching" | "found" | "not_found" | "error";

/** Why a lookup could not give an answer. A refusal the form did not catch is reported as unavailable. */
export type OrderLookupFailure = { kind: "rate_limited"; retryAfterSeconds: number | null } | { kind: "unavailable" };

export interface UseOrderLookupResult {
  values: OrderLookupValues;
  /** Shown after the first submit attempt, then kept live as the shopper edits. */
  errors: OrderLookupFieldErrors;
  status: OrderLookupStatus;
  order: StorefrontOrder | null;
  failure: OrderLookupFailure | null;
  setField: (field: OrderLookupField, value: string) => void;
  submit: () => Promise<void>;
}

function toFailure(error: unknown): OrderLookupFailure {
  if (error instanceof OrderRejectedError) {
    const rejection = error.rejection;
    if (rejection.code === "rate_limited") {
      return { kind: "rate_limited", retryAfterSeconds: rejection.retryAfterSeconds };
    }
  }
  return { kind: "unavailable" };
}

/**
 * Looks up an order by its reference and the phone number it was placed with. Lookups go through the storefront that
 * this component is rendered under: the same-origin BFF on a live store, fixtures on the demo. The server does the
 * matching, so this hook never sees an order it was not told to find. initialOrderId prefills the reference.
 */
export function useOrderLookup(initialOrderId = ""): UseOrderLookupResult {
  const transport = useOrderTransport();
  const [values, setValues] = useState<OrderLookupValues>({ ...EMPTY_ORDER_LOOKUP_VALUES, orderId: initialOrderId });
  const [attempted, setAttempted] = useState(false);
  const [status, setStatus] = useState<OrderLookupStatus>("editing");
  const [order, setOrder] = useState<StorefrontOrder | null>(null);
  const [failure, setFailure] = useState<OrderLookupFailure | null>(null);
  const inFlight = useRef(false);

  const errors = useMemo<OrderLookupFieldErrors>(() => {
    if (!attempted) return {};
    const validation = validateOrderLookup(values);
    return validation.ok ? {} : validation.errors;
  }, [attempted, values]);

  const setField = useCallback((field: OrderLookupField, value: string) => {
    setValues((previous) => ({ ...previous, [field]: value }));
  }, []);

  const submit = useCallback(async () => {
    // A second submit while the first is pending would only repeat the same read. Ignore it.
    if (inFlight.current) return;
    setAttempted(true);

    const validation = validateOrderLookup(values);
    if (!validation.ok) return;

    inFlight.current = true;
    setStatus("searching");
    setFailure(null);
    try {
      const found = await transport.lookupOrder(validation.data);
      setOrder(found);
      setStatus(found === null ? "not_found" : "found");
    } catch (error) {
      setOrder(null);
      setFailure(toFailure(error));
      setStatus("error");
    } finally {
      inFlight.current = false;
    }
  }, [values, transport]);

  return { values, errors, status, order, failure, setField, submit };
}
