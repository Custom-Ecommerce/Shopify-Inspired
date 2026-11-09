import { ORDER_STATUS_LABELS } from './order';
import type { DashboardOrderStatus, DashboardOrderTimelineEntry, OrderHistoryKind } from './order';
import { isOrderFlowStatus } from './order-flow';

/**
 * EP-02 OB-5a: the order timeline. A pure function: one list, newest first, of the order being placed, every history entry
 * and every internal note. It carries no user ids.
 */

export interface TimelineHistoryInput {
  from: string;
  to: string;
  at: string;
  note?: string | null;
  /** Written by newer code only. Older entries have none, and it is derived from the entry. */
  kind?: string | null;
}

export interface TimelineNoteInput {
  id?: string | null;
  text: string;
  at: string;
}

export interface OrderTimelineInput {
  createdAt: string;
  /** In the order the entries were written (oldest first, as stored). Equal timestamps rely on this. */
  statusHistory: readonly TimelineHistoryInput[];
  /** In the order they were written, as stored. */
  notes: readonly TimelineNoteInput[];
  cancelReason?: string | null;
}

const TRACKING_PREFIX = 'Tracking updated';
const PAYMENT_PREFIX = 'COD collected';
const CARD_PAYMENT_PREFIX = 'Card payment received';
const STOCK_PREFIX = 'Stock not returned';

const HISTORY_KINDS: readonly string[] = ['status', 'tracking', 'payment', 'stock'];

/** The stored kind when there is a valid one; otherwise worked out from the entry, for entries written before kind existed. */
export function deriveHistoryKind(entry: Pick<TimelineHistoryInput, 'from' | 'to' | 'note' | 'kind'>): OrderHistoryKind {
  if (typeof entry.kind === 'string' && HISTORY_KINDS.includes(entry.kind)) return entry.kind as OrderHistoryKind;
  if (entry.from !== entry.to) return 'status';
  const note = entry.note ?? '';
  if (note.startsWith(TRACKING_PREFIX)) return 'tracking';
  if (note.startsWith(PAYMENT_PREFIX) || note.startsWith(CARD_PAYMENT_PREFIX)) return 'payment';
  if (note.startsWith(STOCK_PREFIX)) return 'stock';
  return 'status';
}

const statusTitle = (status: string): string =>
  isOrderFlowStatus(status) ? ORDER_STATUS_LABELS[status as DashboardOrderStatus] : status;

/** "Tracking updated: courier" under the title "Tracking updated" reads as a repeat, so only the part after it is kept. */
function afterPrefix(note: string | null | undefined, prefix: string): string | null {
  const text = (note ?? '').trim();
  if (text === '') return null;
  if (!text.startsWith(prefix)) return text;
  const rest = text.slice(prefix.length).replace(/^[:\s]+/, '');
  return rest === '' ? null : rest;
}

function historyEntry(entry: TimelineHistoryInput, index: number, cancelReason: string | null): DashboardOrderTimelineEntry {
  const kind = deriveHistoryKind(entry);
  const base = { id: 'history-' + index, kind, at: entry.at };
  if (kind === 'tracking') return { ...base, title: TRACKING_PREFIX, detail: afterPrefix(entry.note, TRACKING_PREFIX) };
  if (kind === 'payment') {
    const title = (entry.note ?? '').startsWith(CARD_PAYMENT_PREFIX) ? CARD_PAYMENT_PREFIX : PAYMENT_PREFIX;
    return { ...base, title, detail: afterPrefix(entry.note, title) };
  }
  if (kind === 'stock') return { ...base, title: STOCK_PREFIX, detail: afterPrefix(entry.note, STOCK_PREFIX) };

  const note = (entry.note ?? '').trim();
  // The move into cancelled shows why: the reason is kept on the order, the optional note on the entry.
  const parts = entry.to === 'cancelled' && entry.from !== entry.to ? [cancelReason ?? '', note] : [note];
  const detail = parts.filter((part) => part !== '').join(' · ');
  return { ...base, title: statusTitle(entry.to), detail: detail === '' ? null : detail };
}

const timeOf = (iso: string): number => {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
};

/**
 * Newest first. On equal timestamps the entry written later comes first; "Order placed" is the oldest thing there is, and
 * a note sorts above a history entry of the same moment. The result is the same for the same input.
 */
export function buildOrderTimeline(input: OrderTimelineInput): DashboardOrderTimelineEntry[] {
  const cancelReason = input.cancelReason ?? null;
  const entries: DashboardOrderTimelineEntry[] = [
    { id: 'placed', kind: 'placed', at: input.createdAt, title: 'Order placed', detail: null },
    ...input.statusHistory.map((entry, index) => historyEntry(entry, index, cancelReason)),
    ...input.notes.map(
      (note, index): DashboardOrderTimelineEntry => ({
        id: 'note-' + (note.id ?? index),
        kind: 'note',
        at: note.at,
        title: 'Note added',
        detail: note.text,
      }),
    ),
  ];
  return entries
    .map((entry, sequence) => ({ entry, sequence, time: timeOf(entry.at) }))
    .sort((a, b) => (a.time === b.time ? b.sequence - a.sequence : b.time - a.time))
    .map(({ entry }) => entry);
}
