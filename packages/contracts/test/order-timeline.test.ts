import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderTimeline, deriveHistoryKind } from '../src/order-timeline';
import { dashboardOrderTimelineEntrySchema } from '../src/order';

// EP-02 OB-5a: the order timeline.

const CREATED = '2026-11-01T10:00:00.000Z';
const at = (day: number, hour = 10): string => '2026-11-' + String(day).padStart(2, '0') + 'T' + String(hour).padStart(2, '0') + ':00:00.000Z';

const base = { createdAt: CREATED, statusHistory: [], notes: [] };

test('timeline: an old order with no history or notes is just "Order placed"', () => {
  assert.deepEqual(buildOrderTimeline(base), [{ id: 'placed', kind: 'placed', at: CREATED, title: 'Order placed', detail: null }]);
});

test('timeline: everything merges into one list, newest first', () => {
  const timeline = buildOrderTimeline({
    createdAt: CREATED,
    statusHistory: [
      { from: 'pending', to: 'confirmed', at: at(2), note: null },
      { from: 'confirmed', to: 'processing', at: at(4), note: 'Packed' },
    ],
    notes: [{ id: 'n1', text: 'Call first', at: at(3) }],
  });
  assert.deepEqual(timeline.map((entry) => entry.title), ['Processing', 'Note added', 'Confirmed', 'Order placed']);
  assert.equal(timeline[0].detail, 'Packed');
  assert.equal(timeline[1].detail, 'Call first');
  assert.equal(timeline[1].id, 'note-n1');
  for (const entry of timeline) assert.equal(dashboardOrderTimelineEntrySchema.safeParse(entry).success, true);
});

test('timeline: every kind has its plain-English title and detail', () => {
  const timeline = buildOrderTimeline({
    createdAt: CREATED,
    cancelReason: 'Out of stock',
    statusHistory: [
      { from: 'processing', to: 'dispatched', at: at(2), note: null },
      { from: 'dispatched', to: 'dispatched', at: at(3), note: 'Tracking updated: courier, tracking number', kind: 'tracking' },
      { from: 'dispatched', to: 'dispatched', at: at(4), note: 'COD collected: Rs. 4,500', kind: 'payment' },
      { from: 'pending', to: 'cancelled', at: at(5), note: 'Called twice' },
      { from: 'cancelled', to: 'cancelled', at: at(6), note: 'Stock not returned: Cap (product deleted)', kind: 'stock' },
    ],
    notes: [{ id: 'n1', text: 'Internal', at: at(7) }],
  });
  assert.deepEqual(
    timeline.map((entry) => [entry.kind, entry.title, entry.detail]),
    [
      ['note', 'Note added', 'Internal'],
      ['stock', 'Stock not returned', 'Cap (product deleted)'],
      ['status', 'Cancelled', 'Out of stock · Called twice'],
      ['payment', 'COD collected', 'Rs. 4,500'],
      ['tracking', 'Tracking updated', 'courier, tracking number'],
      ['status', 'Dispatched', null],
      ['placed', 'Order placed', null],
    ],
  );
});

test('timeline: entries without a kind are derived from what they say', () => {
  const entry = (from: string, to: string, note: string | null) => ({ from, to, note });
  assert.equal(deriveHistoryKind(entry('pending', 'confirmed', 'COD collected: nope')), 'status', 'a real move is a status');
  assert.equal(deriveHistoryKind(entry('dispatched', 'dispatched', 'Tracking updated: courier')), 'tracking');
  assert.equal(deriveHistoryKind(entry('dispatched', 'dispatched', 'COD collected: Rs. 10')), 'payment');
  assert.equal(deriveHistoryKind(entry('cancelled', 'cancelled', 'Stock not returned: Cap')), 'stock');
  assert.equal(deriveHistoryKind(entry('dispatched', 'dispatched', 'something else')), 'status');
  assert.equal(deriveHistoryKind(entry('dispatched', 'dispatched', null)), 'status');
  assert.equal(deriveHistoryKind({ from: 'dispatched', to: 'dispatched', note: 'free text', kind: 'payment' }), 'payment', 'a stored kind wins');
  assert.equal(deriveHistoryKind({ from: 'pending', to: 'confirmed', note: null, kind: 'bogus' }), 'status', 'an unknown kind is ignored');
});

test('timeline: equal timestamps keep a stable order, the later-written first and "Order placed" last', () => {
  const same = at(2);
  const input = {
    createdAt: same,
    statusHistory: [
      { from: 'pending', to: 'cancelled', at: same, note: null },
      { from: 'cancelled', to: 'cancelled', at: same, note: 'Stock not returned: Cap' },
    ],
    notes: [{ id: 'n1', text: 'a', at: same }],
  };
  const titles = buildOrderTimeline(input).map((entry) => entry.title);
  assert.deepEqual(titles, ['Note added', 'Stock not returned', 'Cancelled', 'Order placed']);
  assert.deepEqual(buildOrderTimeline(input).map((entry) => entry.title), titles, 'the same every time');
});

test('timeline: history ids are unique, a note without an id still has one, and no user ids leak', () => {
  const timeline = buildOrderTimeline({
    createdAt: CREATED,
    statusHistory: [
      { from: 'pending', to: 'confirmed', at: at(2), note: null, by: '65a000000000000000000001' } as never,
      { from: 'confirmed', to: 'processing', at: at(3), note: null, by: '65a000000000000000000001' } as never,
    ],
    notes: [{ text: 'no id', at: at(4), by: '65a000000000000000000001' } as never],
  });
  const ids = timeline.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(JSON.stringify(timeline).includes('65a000000000000000000001'), false);
  for (const entry of timeline) assert.deepEqual(Object.keys(entry).sort(), ['at', 'detail', 'id', 'kind', 'title']);
});

test('D-082: a card payment is a payment entry under its own title', () => {
  const timeline = buildOrderTimeline({
    createdAt: '2026-11-10T10:00:00.000Z',
    statusHistory: [{ from: 'pending', to: 'pending', at: '2026-11-10T10:05:00.000Z', note: 'Card payment received: Rs. 1,250', kind: 'payment' }],
    notes: [],
  });
  assert.deepEqual(timeline[0], { id: 'history-0', kind: 'payment', at: '2026-11-10T10:05:00.000Z', title: 'Card payment received', detail: 'Rs. 1,250' });
});

test('D-082: a card payment entry with no stored kind is still read as a payment', () => {
  assert.equal(deriveHistoryKind({ from: 'pending', to: 'pending', note: 'Card payment received: Rs. 1,250' }), 'payment');
});
