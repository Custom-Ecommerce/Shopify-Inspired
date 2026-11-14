import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canMarkCollected,
  paymentRefusal,
  CANCELLABLE_STATUSES,
  canCancel,
  cancelRefusal,
  ORDER_CANCEL_REFUSAL_MESSAGES,
  canTransition,
  isOrderFlowStatus,
  nextStatuses,
  ORDER_FLOW,
  ORDER_FLOW_STATUSES,
  ORDER_TRANSITION_REFUSAL_MESSAGES,
  transitionRefusal,
  cardPaymentPending,
  paidCardOrder,
} from '../src/order-flow';
import { DASHBOARD_ORDER_STATUSES } from '../src/order';
import { STOREFRONT_ORDER_STATUSES } from '../src/storefront';

// EP-02 OB-2: the order status workflow (D-064, D-065).

const LEGAL: ReadonlyArray<[string, string]> = [
  ['pending', 'confirmed'],
  ['confirmed', 'processing'],
  ['processing', 'dispatched'],
  ['dispatched', 'delivered'],
];

const isLegal = (from: string, to: string): boolean => LEGAL.some(([f, t]) => f === from && t === to);

test('order flow: the statuses are the same seven as the storefront and dashboard sets', () => {
  assert.deepEqual([...ORDER_FLOW_STATUSES], [...STOREFRONT_ORDER_STATUSES]);
  assert.deepEqual([...ORDER_FLOW_STATUSES], [...DASHBOARD_ORDER_STATUSES]);
  assert.deepEqual(Object.keys(ORDER_FLOW).sort(), [...ORDER_FLOW_STATUSES].sort());
});

test('order flow: of all 49 pairs exactly the four forward steps are legal', () => {
  let legal = 0;
  for (const from of ORDER_FLOW_STATUSES) {
    for (const to of ORDER_FLOW_STATUSES) {
      const expected = isLegal(from, to);
      assert.equal(canTransition(from, to), expected, from + ' -> ' + to);
      assert.equal(transitionRefusal(from, to) === null, expected, from + ' -> ' + to);
      if (expected) legal += 1;
    }
  }
  assert.equal(legal, 4);
});

test('order flow: nextStatuses gives one step forward, nothing out of a final status', () => {
  assert.deepEqual(nextStatuses('pending'), ['confirmed']);
  assert.deepEqual(nextStatuses('confirmed'), ['processing']);
  assert.deepEqual(nextStatuses('processing'), ['dispatched']);
  assert.deepEqual(nextStatuses('dispatched'), ['delivered']);
  for (const status of ['delivered', 'cancelled', 'returned']) assert.deepEqual(nextStatuses(status), [], status);
  for (const from of ORDER_FLOW_STATUSES) {
    for (const to of nextStatuses(from)) assert.equal(canTransition(from, to), true, from + ' -> ' + to);
  }
});

test('order flow: an unknown or corrupt status has no legal moves', () => {
  for (const bad of ['shipped', 'PENDING', '', ' pending', null, undefined, 3, {}]) {
    assert.deepEqual(nextStatuses(bad), [], String(bad));
    assert.equal(isOrderFlowStatus(bad), false, String(bad));
    assert.equal(canTransition(bad, 'confirmed'), false, String(bad));
    assert.equal(canTransition('pending', bad), false, String(bad));
    assert.equal(transitionRefusal(bad, 'confirmed'), 'unknown_status', String(bad));
  }
});

test('order flow: nextStatuses returns a fresh array the caller cannot use to change the flow', () => {
  const next = nextStatuses('pending');
  next.push('delivered');
  assert.deepEqual(nextStatuses('pending'), ['confirmed']);
});

test('order flow: each refusal reason', () => {
  assert.equal(transitionRefusal('pending', 'pending'), 'same_status');
  assert.equal(transitionRefusal('delivered', 'pending'), 'final_status');
  assert.equal(transitionRefusal('cancelled', 'confirmed'), 'final_status');
  assert.equal(transitionRefusal('returned', 'delivered'), 'final_status');
  assert.equal(transitionRefusal('pending', 'cancelled'), 'cancel_elsewhere');
  assert.equal(transitionRefusal('dispatched', 'cancelled'), 'cancel_elsewhere');
  assert.equal(transitionRefusal('dispatched', 'returned'), 'return_elsewhere');
  assert.equal(transitionRefusal('dispatched', 'processing'), 'backwards');
  assert.equal(transitionRefusal('confirmed', 'pending'), 'backwards');
  assert.equal(transitionRefusal('pending', 'processing'), 'skips_step');
  assert.equal(transitionRefusal('pending', 'delivered'), 'skips_step');
  for (const message of Object.values(ORDER_TRANSITION_REFUSAL_MESSAGES)) assert.ok(message.length > 0);
});

// EP-02 OB-3: cancel (D-064).

test('cancel: allowed from pending, confirmed and processing only', () => {
  assert.deepEqual([...CANCELLABLE_STATUSES], ['pending', 'confirmed', 'processing']);
  const expected: Record<string, ReturnType<typeof cancelRefusal>> = {
    pending: null,
    confirmed: null,
    processing: null,
    dispatched: 'dispatched_or_later',
    delivered: 'dispatched_or_later',
    returned: 'dispatched_or_later',
    cancelled: 'already_cancelled',
  };
  for (const status of ORDER_FLOW_STATUSES) {
    assert.equal(cancelRefusal(status), expected[status], status);
    assert.equal(canCancel(status), expected[status] === null, status);
  }
});

test('cancel: an unknown or corrupt status cannot be cancelled', () => {
  for (const bad of ['shipped', '', 'Pending', null, undefined, 7]) {
    assert.equal(cancelRefusal(bad), 'unknown_status', String(bad));
    assert.equal(canCancel(bad), false, String(bad));
  }
});

test('cancel: every refusal has a message, and the forward flow still never moves into cancelled', () => {
  for (const reason of ['already_cancelled', 'dispatched_or_later', 'unknown_status'] as const) {
    assert.ok(ORDER_CANCEL_REFUSAL_MESSAGES[reason].length > 0, reason);
  }
  for (const from of CANCELLABLE_STATUSES) assert.equal(canTransition(from, 'cancelled'), false, from);
});

// EP-02 OB-5a: COD collected (D-064).

test('payment: allowed once dispatched or delivered; refused before dispatch and on a closed order', () => {
  const expected: Record<string, ReturnType<typeof paymentRefusal>> = {
    pending: 'before_dispatch',
    confirmed: 'before_dispatch',
    processing: 'before_dispatch',
    dispatched: null,
    delivered: null,
    cancelled: 'order_closed',
    returned: 'order_closed',
  };
  for (const status of ORDER_FLOW_STATUSES) assert.equal(paymentRefusal(status), expected[status], status);
  for (const bad of ['shipped', '', null, undefined]) assert.equal(paymentRefusal(bad), 'order_closed', String(bad));
});

test('payment: canMarkCollected needs COD, unpaid and dispatched or delivered', () => {
  assert.equal(canMarkCollected({ paymentMethod: 'cod', paymentStatus: 'unpaid', status: 'dispatched' }), true);
  assert.equal(canMarkCollected({ paymentMethod: 'cod', status: 'delivered' }), true, 'a missing paymentStatus is unpaid');
  assert.equal(canMarkCollected({ paymentMethod: 'cod', paymentStatus: 'collected', status: 'delivered' }), false);
  assert.equal(canMarkCollected({ paymentMethod: 'card', paymentStatus: 'unpaid', status: 'delivered' }), false);
  assert.equal(canMarkCollected({ paymentStatus: 'unpaid', status: 'delivered' }), false, 'no method is not COD');
  assert.equal(canMarkCollected({ paymentMethod: 'cod', paymentStatus: 'unpaid', status: 'processing' }), false);
  assert.equal(canMarkCollected({ paymentMethod: 'cod', paymentStatus: 'unpaid', status: 'cancelled' }), false);
});

test('D-082: only an unpaid card order is held back from dispatch', () => {
  assert.equal(cardPaymentPending({ paymentMethod: 'card', paymentStatus: 'unpaid' }), true);
  assert.equal(cardPaymentPending({ paymentMethod: 'card' }), true);
  assert.equal(cardPaymentPending({ paymentMethod: 'card', paymentStatus: 'paid' }), false);
  assert.equal(cardPaymentPending({ paymentMethod: 'cod', paymentStatus: 'unpaid' }), false);
  assert.equal(cardPaymentPending({}), false);
});

test('D-082: a card order can never be marked COD collected, paid or not', () => {
  assert.equal(canMarkCollected({ paymentMethod: 'card', paymentStatus: 'unpaid', status: 'dispatched' }), false);
  assert.equal(canMarkCollected({ paymentMethod: 'card', paymentStatus: 'paid', status: 'delivered' }), false);
});

test('a paid card order is the only one held back from a hand cancel', () => {
  assert.equal(paidCardOrder({ paymentMethod: 'card', paymentStatus: 'paid' }), true);
  assert.equal(paidCardOrder({ paymentMethod: 'card', paymentStatus: 'unpaid' }), false);
  assert.equal(paidCardOrder({ paymentMethod: 'cod', paymentStatus: 'collected' }), false);
  assert.match(ORDER_CANCEL_REFUSAL_MESSAGES.card_paid, /Refunds/);
});
