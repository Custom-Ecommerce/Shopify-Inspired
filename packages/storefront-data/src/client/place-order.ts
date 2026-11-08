import { OrderUnconfirmedError, TransportUnavailableError } from "../transport/errors";
import type { OrderTransport, SubmitOrderPayload, SubmitOrderResult } from "../transport/types";

/** No clear answer: the order may or may not have been saved. An answer from the server, even a refusal, is not this. */
export function isOutcomeUnknown(error: unknown): boolean {
  return error instanceof TransportUnavailableError && (error.reason === "timeout" || error.reason === "network");
}

/**
 * Places an order and never reports "failed" for a placement that got no answer (CO-03). When the answer does not come, the
 * same payload is sent once more with the same idempotency key: the server returns the saved order, or places it once.
 *
 *   an answer on either try     the order, or the server's refusal, as normal
 *   no answer on both tries     OrderUnconfirmedError; retrying with the same key is safe
 *
 * Pure of React and of browser storage, so it can be checked on its own.
 */
export async function placeOrderWithCheck(
  transport: Pick<OrderTransport, "submitOrder">,
  payload: SubmitOrderPayload,
  onChecking: () => void,
): Promise<SubmitOrderResult> {
  try {
    return await transport.submitOrder(payload);
  } catch (error) {
    if (!isOutcomeUnknown(error)) throw error;
  }

  onChecking();
  try {
    return await transport.submitOrder(payload);
  } catch (error) {
    if (isOutcomeUnknown(error)) throw new OrderUnconfirmedError();
    throw error;
  }
}
