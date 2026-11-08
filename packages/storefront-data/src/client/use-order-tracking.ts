"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { EMPTY_ORDER_LOOKUP_VALUES, validateOrderLookup } from "../domain/order-lookup";
import type { OrderLookupField, OrderLookupFieldErrors, OrderLookupValues } from "../domain/order-lookup";
import { OrderRejectedError } from "../transport/errors";
import type { StorefrontOrderTracking } from "../transport/types";
import type { OrderLookupFailure, OrderLookupStatus } from "./use-order-lookup";
import { useOrderTransport } from "./context";

export interface UseOrderTrackingResult {
  values: OrderLookupValues;
  /** Shown after the first submit attempt, then kept live as the shopper edits. */
  errors: OrderLookupFieldErrors;
  /** The same states as the order lookup: "not_found" is an answer, not a failure. */
  status: OrderLookupStatus;
  tracking: StorefrontOrderTracking | null;
  failure: OrderLookupFailure | null;
  setField: (field: OrderLookupField, value: string) => void;
  submit: () => Promise<void>;
}

function toFailure(error: unknown): OrderLookupFailure {
  if (error instanceof OrderRejectedError && error.rejection.code === "rate_limited") {
    return { kind: "rate_limited", retryAfterSeconds: error.rejection.retryAfterSeconds };
  }
  return { kind: "unavailable" };
}

/**
 * Customer tracking (EP-02 OB-4, D-069). The same form and validation as useOrderLookup (order reference and phone), but
 * the answer is the parcel's journey only: status, the date of each step, courier and tracking. The values live in React
 * state only; nothing is written to browser storage.
 */
export function useOrderTracking(initialOrderId = ""): UseOrderTrackingResult {
  const transport = useOrderTransport();
  const [values, setValues] = useState<OrderLookupValues>({ ...EMPTY_ORDER_LOOKUP_VALUES, orderId: initialOrderId });
  const [attempted, setAttempted] = useState(false);
  const [status, setStatus] = useState<OrderLookupStatus>("editing");
  const [tracking, setTracking] = useState<StorefrontOrderTracking | null>(null);
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
    if (inFlight.current) return;
    setAttempted(true);

    const validation = validateOrderLookup(values);
    if (!validation.ok) return;

    inFlight.current = true;
    setStatus("searching");
    setFailure(null);
    try {
      const found = await transport.trackOrder(validation.data);
      setTracking(found);
      setStatus(found === null ? "not_found" : "found");
    } catch (error) {
      setTracking(null);
      setFailure(toFailure(error));
      setStatus("error");
    } finally {
      inFlight.current = false;
    }
  }, [values, transport]);

  return { values, errors, status, tracking, failure, setField, submit };
}
