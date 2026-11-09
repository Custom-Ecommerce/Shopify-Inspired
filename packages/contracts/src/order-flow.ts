/**
 * EP-02 order status workflow (D-064, D-065). A pure module with no dependencies: the seller backend decides every
 * transition with it, and the dashboard shows the buttons it allows, so the flow lives in one place.
 *
 *   pending -> confirmed -> processing -> dispatched -> delivered
 *
 * Strictly one step forward. No skipping, no going back, nothing out of delivered, cancelled or returned, and no move into
 * cancelled (the cancel endpoint, OB-3) or returned (EP-13). An unknown or corrupt status has no legal moves.
 */

/** Every stored order status. The same seven, in the same order, as STOREFRONT_ORDER_STATUSES and the Order model. */
export const ORDER_FLOW_STATUSES = [
  'pending',
  'confirmed',
  'processing',
  'dispatched',
  'delivered',
  'cancelled',
  'returned',
] as const;
export type OrderFlowStatus = (typeof ORDER_FLOW_STATUSES)[number];

/** The forward path, in order. cancelled and returned are not on it. */
export const ORDER_FLOW_PATH: readonly OrderFlowStatus[] = ['pending', 'confirmed', 'processing', 'dispatched', 'delivered'];

/** The legal next statuses of each status. Exactly four moves exist. */
export const ORDER_FLOW: Readonly<Record<OrderFlowStatus, readonly OrderFlowStatus[]>> = {
  pending: ['confirmed'],
  confirmed: ['processing'],
  processing: ['dispatched'],
  dispatched: ['delivered'],
  delivered: [],
  cancelled: [],
  returned: [],
};

export function isOrderFlowStatus(value: unknown): value is OrderFlowStatus {
  return typeof value === 'string' && (ORDER_FLOW_STATUSES as readonly string[]).includes(value);
}

/** Where an order in this status may go next. Empty for a final, unknown or corrupt status. A new array each call. */
export function nextStatuses(from: unknown): OrderFlowStatus[] {
  return isOrderFlowStatus(from) ? [...ORDER_FLOW[from]] : [];
}

/** True only for the four forward steps. The same status is not a transition. */
export function canTransition(from: unknown, to: unknown): boolean {
  return isOrderFlowStatus(from) && isOrderFlowStatus(to) && ORDER_FLOW[from].includes(to);
}

export type OrderTransitionRefusal =
  | 'unknown_status'
  | 'same_status'
  | 'final_status'
  | 'cancel_elsewhere'
  | 'return_elsewhere'
  | 'backwards'
  | 'skips_step';

/** Plain words for each refusal, for logs and error messages. */
export const ORDER_TRANSITION_REFUSAL_MESSAGES: Readonly<Record<OrderTransitionRefusal, string>> = {
  unknown_status: 'One of the statuses is not a known order status.',
  same_status: 'The order already has this status.',
  final_status: 'This order is finished: its status cannot change any more.',
  cancel_elsewhere: 'Cancelling an order is a separate action, not a status change.',
  return_elsewhere: 'Returns are handled separately, not as a status change.',
  backwards: 'An order cannot go back to an earlier status.',
  skips_step: 'An order moves one step at a time and cannot skip a status.',
};

/** Why a move is refused, or null when it is legal. Checked in this order, so the first reason that applies wins. */
export function transitionRefusal(from: unknown, to: unknown): OrderTransitionRefusal | null {
  if (!isOrderFlowStatus(from) || !isOrderFlowStatus(to)) return 'unknown_status';
  if (from === to) return 'same_status';
  if (ORDER_FLOW[from].includes(to)) return null;
  if (from === 'delivered' || from === 'cancelled' || from === 'returned') return 'final_status';
  if (to === 'cancelled') return 'cancel_elsewhere';
  if (to === 'returned') return 'return_elsewhere';
  return ORDER_FLOW_PATH.indexOf(to) < ORDER_FLOW_PATH.indexOf(from) ? 'backwards' : 'skips_step';
}

// EP-02 OB-3: cancel (D-064). A separate action from the forward flow: allowed only before dispatch, and final.

/** The statuses an order can be cancelled from. After dispatch the way back is a return (EP-13). */
export const CANCELLABLE_STATUSES: readonly OrderFlowStatus[] = ['pending', 'confirmed', 'processing'];

export type OrderCancelRefusal = 'already_cancelled' | 'dispatched_or_later' | 'unknown_status';

export const ORDER_CANCEL_REFUSAL_MESSAGES: Readonly<Record<OrderCancelRefusal, string>> = {
  already_cancelled: 'This order is already cancelled.',
  dispatched_or_later: 'This order has already been dispatched, so it cannot be cancelled. After dispatch the way back is a return.',
  unknown_status: 'This order has an unknown status, so it cannot be cancelled.',
};

/** Why an order in this status cannot be cancelled, or null when it can. */
export function cancelRefusal(status: unknown): OrderCancelRefusal | null {
  if (!isOrderFlowStatus(status)) return 'unknown_status';
  if (CANCELLABLE_STATUSES.includes(status)) return null;
  if (status === 'cancelled') return 'already_cancelled';
  return 'dispatched_or_later';
}

export function canCancel(status: unknown): boolean {
  return cancelRefusal(status) === null;
}

// EP-02 OB-5a: COD collected (D-064). Only after dispatch, and only for cash on delivery.

export const PAYMENT_COLLECTABLE_STATUSES: readonly OrderFlowStatus[] = ['dispatched', 'delivered'];

export type OrderPaymentRefusal = 'before_dispatch' | 'order_closed';

/** Why COD cannot be marked collected in this status, or null when it can. An unknown status counts as closed. */
export function paymentRefusal(status: unknown): OrderPaymentRefusal | null {
  if (isOrderFlowStatus(status) && PAYMENT_COLLECTABLE_STATUSES.includes(status)) return null;
  return status === 'pending' || status === 'confirmed' || status === 'processing' ? 'before_dispatch' : 'order_closed';
}

/** A card order is paid before it ships. Cash on delivery is not affected. */
export function cardPaymentPending(order: { paymentMethod?: unknown; paymentStatus?: unknown }): boolean {
  return order.paymentMethod === 'card' && order.paymentStatus !== 'paid';
}

/** COD, not collected yet (a missing paymentStatus is unpaid), and dispatched or delivered. */
export function canMarkCollected(order: { paymentMethod?: unknown; paymentStatus?: unknown; status?: unknown }): boolean {
  return order.paymentMethod === 'cod' && order.paymentStatus !== 'collected' && paymentRefusal(order.status) === null;
}
