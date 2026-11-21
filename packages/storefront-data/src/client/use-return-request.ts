"use client";

import { useCallback, useRef, useState } from "react";
import { OrderRejectedError, ReturnRefusedError } from "../transport/errors";
import type { ReturnReasonCode, StorefrontReturnCreated, StorefrontReturnEligibility } from "../transport/types";
import { useOrderTransport } from "./context";

export type ReturnRequestStatus = "idle" | "loading" | "ready" | "submitting" | "done" | "not_found" | "error";

export interface UseReturnRequestResult {
  status: ReturnRequestStatus;
  /** What may still be returned from the order, once loaded. */
  eligibility: StorefrontReturnEligibility | null;
  /** The return number, once the request was accepted. */
  created: StorefrontReturnCreated | null;
  /** A sentence for the shopper when the last call failed or was refused. */
  message: string | null;
  /** Reads what can be returned from this order (order number + phone: the same credential as tracking). */
  load: (orderId: string, phone: string) => Promise<void>;
  /** Asks for a return of these lines. The phone is the one given to load. */
  submit: (input: { orderId: string; phone: string; items: Array<{ productId: string; variantId: string; quantity: number }>; reasonCode: ReturnReasonCode; note?: string | null }) => Promise<void>;
}

/**
 * Sprint 5 EP-13.US01.T03 / T04 (D-107, D-108): the "Request a return" flow of a delivered order, for both themes. Two calls: the eligibility
 * (what is returnable, the window) and the request itself. The credential is the order number and the phone, never kept in browser storage:
 * the values live in React state only. A wrong phone and an unknown order read the same (not_found).
 */
export function useReturnRequest(): UseReturnRequestResult {
  const transport = useOrderTransport();
  const [status, setStatus] = useState<ReturnRequestStatus>("idle");
  const [eligibility, setEligibility] = useState<StorefrontReturnEligibility | null>(null);
  const [created, setCreated] = useState<StorefrontReturnCreated | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  const toMessage = (error: unknown): string => {
    if (error instanceof ReturnRefusedError) return error.message;
    if (error instanceof OrderRejectedError && error.rejection.code === "rate_limited") return "Too many attempts. Please wait a moment and try again.";
    if (error instanceof OrderRejectedError && error.rejection.code === "invalid_request") return error.rejection.message;
    return "We could not reach the store. Please try again.";
  };

  const load = useCallback(
    async (orderId: string, phone: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setStatus("loading");
      setMessage(null);
      try {
        const found = await transport.getReturnEligibility({ orderId, phone });
        setEligibility(found);
        setStatus(found === null ? "not_found" : "ready");
      } catch (error) {
        setEligibility(null);
        setMessage(toMessage(error));
        setStatus("error");
      } finally {
        inFlight.current = false;
      }
    },
    [transport],
  );

  const submit = useCallback(
    async (input: { orderId: string; phone: string; items: Array<{ productId: string; variantId: string; quantity: number }>; reasonCode: ReturnReasonCode; note?: string | null }) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setStatus("submitting");
      setMessage(null);
      try {
        const result = await transport.submitReturn(input);
        if (result === null) {
          setStatus("not_found");
          return;
        }
        setCreated(result);
        setStatus("done");
      } catch (error) {
        setMessage(toMessage(error));
        // A refusal (window closed, nothing left) is the store's answer: the form stays so the shopper can read it and change the quantities.
        setStatus("ready");
      } finally {
        inFlight.current = false;
      }
    },
    [transport],
  );

  return { status, eligibility, created, message, load, submit };
}
