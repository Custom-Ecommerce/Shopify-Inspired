"use client";

import { useCallback, useRef, useState } from "react";
import { OrderRejectedError, ReviewRefusedError } from "../transport/errors";
import type { StorefrontReviewCreated, StorefrontReviewEligibility, SubmitReviewInput } from "../transport/types";
import { useOrderTransport } from "./context";

export type ReviewRequestStatus = "idle" | "loading" | "ready" | "submitting" | "done" | "not_found" | "error";

export interface UseReviewRequestResult {
  status: ReviewRequestStatus;
  /** The delivered products of the order that have no review yet, once loaded. */
  eligibility: StorefrontReviewEligibility | null;
  /** The review that was just published. */
  created: StorefrontReviewCreated | null;
  /** The products reviewed in this visit, so the form can say thank you for each and offer the rest. */
  reviewedProductIds: string[];
  /** A sentence for the shopper when the last call failed or was refused. */
  message: string | null;
  /** Reads what can be reviewed (order number + phone: the same credential as tracking and returns). */
  load: (orderId: string, phone: string) => Promise<void>;
  /** Publishes a review. The order number and the phone are the ones given to load. */
  submit: (input: SubmitReviewInput) => Promise<void>;
}

/**
 * Sprint 5 EP-21.US01.T02 / T04 (D-107, D-108): the "Review your order" flow of a delivered order, for both themes. Two calls: the eligibility (which
 * delivered products still have no review) and the review itself, which is published at once. The credential is the order number and the phone,
 * never kept in browser storage: the values live in React state only. A wrong phone and an unknown order read the same (not_found). The text is
 * plain text: whatever shows it renders it as text.
 */
export function useReviewRequest(): UseReviewRequestResult {
  const transport = useOrderTransport();
  const [status, setStatus] = useState<ReviewRequestStatus>("idle");
  const [eligibility, setEligibility] = useState<StorefrontReviewEligibility | null>(null);
  const [created, setCreated] = useState<StorefrontReviewCreated | null>(null);
  const [reviewedProductIds, setReviewedProductIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  const toMessage = (error: unknown): string => {
    if (error instanceof ReviewRefusedError) return error.message;
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
        const found = await transport.getReviewEligibility({ orderId, phone });
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
    async (input: SubmitReviewInput) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setStatus("submitting");
      setMessage(null);
      try {
        const result = await transport.submitReview(input);
        if (result === null) {
          setStatus("not_found");
          return;
        }
        setCreated(result);
        setReviewedProductIds((previous) => [...previous, input.productId]);
        // The product just reviewed leaves the list; what is left stays open for the next review.
        setEligibility((previous) => {
          if (previous === null) return previous;
          const items = previous.items.filter((item) => item.productId !== input.productId);
          return items.length === 0 ? { eligible: false, reason: "nothing_to_review", items } : { ...previous, items };
        });
        setStatus("done");
      } catch (error) {
        setMessage(toMessage(error));
        // A refusal (already reviewed, not delivered) is the store's answer: the form stays so the shopper can read it.
        setStatus("ready");
      } finally {
        inFlight.current = false;
      }
    },
    [transport],
  );

  return { status, eligibility, created, reviewedProductIds, message, load, submit };
}
