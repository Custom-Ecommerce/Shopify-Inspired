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
