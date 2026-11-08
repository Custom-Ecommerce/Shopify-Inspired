import type { OrderRejection } from "./types";

/** The server refused an order or an order lookup. The rejection says why, so the UI can point at the cause. */
export class OrderRejectedError extends Error {
  readonly rejection: OrderRejection;

  constructor(rejection: OrderRejection) {
    super("Order rejected: " + rejection.code);
    this.name = "OrderRejectedError";
    this.rejection = rejection;
  }
}

/**
 * Why the remote transport could not produce data.
 * - not_implemented: stub mode. The backend is not wired yet, so nothing was sent.
 * - timeout / network: the seller backend did not answer (after one retry for reads).
 * - http: the backend answered with a non-2xx status, carried in upstreamStatus.
 * - invalid_response: the backend answered 2xx with a body the contract does not allow.
 */
export type TransportUnavailableReason = "not_implemented" | "timeout" | "network" | "http" | "invalid_response";

export class TransportUnavailableError extends Error {
  readonly reason: TransportUnavailableReason;
  readonly upstreamStatus: number | undefined;

  constructor(reason: TransportUnavailableReason, message?: string, upstreamStatus?: number) {
    super(message ?? "Storefront data is unavailable (" + reason + ").");
    this.name = "TransportUnavailableError";
    this.reason = reason;
    this.upstreamStatus = upstreamStatus;
  }
}

/** The BFF's code when the backend did not answer an order placement: the order may or may not have been saved. */
export const ORDER_OUTCOME_UNKNOWN_CODE = "ORDER_OUTCOME_UNKNOWN";

/** Placement timed out and the check with the same idempotency key could not reach the server either (CO-03). */
export class OrderUnconfirmedError extends Error {
  constructor() {
    super("The order could not be confirmed.");
    this.name = "OrderUnconfirmedError";
  }
}

/** Configuration that is invalid or unsafe, for example mock data requested in production. */
export class TransportConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransportConfigError";
  }
}
