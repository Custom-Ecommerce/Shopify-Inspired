import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTBOX_FIRST_RETRY_MS,
  OUTBOX_MAX_ATTEMPTS,
  enqueueNotification,
  flushOutbox,
  retryDelayMs,
  sendOutboxRow,
  createLogProvider,
  type EmailMessage,
  type EmailProvider,
  type NotificationOutboxModel,
  type SendResult,
  type TemplateVars,
} from '../src/index';

// The outbox with a fake model: no database. findOneAndUpdate matches and writes in one synchronous step, as MongoDB
// does for one document, so the claim compare-and-set behaves like the real thing.

type Row = Record<string, any>;

function matchValue(actual: unknown, condition: unknown): boolean {
  if (condition !== null && typeof condition === 'object' && !(condition instanceof Date) && !Array.isArray(condition)) {
    return Object.entries(condition as Record<string, unknown>).every(([op, value]) => {
      if (op === '$in') return (value as unknown[]).includes(actual);
      if (op === '$lt') return typeof actual === 'number' && actual < (value as number);
      if (op === '$lte') return actual instanceof Date && actual.getTime() <= (value as Date).getTime();
      throw new Error('fake model: unsupported operator ' + op);
    });
  }
  return String(actual) === String(condition);
}

const matches = (row: Row, filter: Row): boolean => Object.entries(filter).every(([key, condition]) => matchValue(row[key], condition));

function fakeOutbox(options: { createFails?: boolean } = {}) {
  const rows: Row[] = [];
  let next = 1;
  const model = {
    async create(doc: Row) {
      if (options.createFails) throw new Error('database down');
      if (doc.dedupeKey !== undefined && rows.some((r) => r.dedupeKey === doc.dedupeKey)) {
        throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
      }
      const row = { _id: 'row' + next++, ...doc };
      rows.push(row);
      return { ...row };
    },
    findOne(filter: Row) {
      return { lean: async () => (rows.find((r) => matches(r, filter)) ? { ...rows.find((r) => matches(r, filter))! } : null) };
    },
    find(filter: Row) {
      let limit = Infinity;
      const q = {
        sort: () => q,
        limit: (n: number) => {
          limit = n;
          return q;
        },
        lean: async () => rows.filter((r) => matches(r, filter)).slice(0, limit).map((r) => ({ ...r })),
      };
      return q;
    },
    findOneAndUpdate(filter: Row, update: Row) {
      return {
        lean: async () => {
          const row = rows.find((r) => matches(r, filter));
          if (!row) return null;
          Object.assign(row, update.$set ?? {});
          for (const [key, by] of Object.entries(update.$inc ?? {})) row[key] = (row[key] ?? 0) + (by as number);
          return { ...row };
        },
      };
    },
  };
  return { rows, model: model as unknown as NotificationOutboxModel };
}

function fakeProvider(results: SendResult[] = []) {
  const sent: EmailMessage[] = [];
  const provider: EmailProvider = {
    name: 'fake',
    async send(message) {
      sent.push(message);
      return results.shift() ?? { ok: true, status: 'sent', providerMessageId: 'msg-' + sent.length };
    },
  };
  return { provider, sent };
}

function clock(start = Date.UTC(2026, 10, 14, 9, 0, 0)) {
  let ms = start;
  return { now: () => new Date(ms), advance: (by: number) => void (ms += by) };
}

const VARS: TemplateVars = {
  storeName: 'Zara Lawn',
  customerName: 'Ayesha',
  orderNumber: 'ORD-ABCD2345',
  trackingLink: 'https://zara.markazify.com/track?order=ORD-ABCD2345',
};

const silent = () => {};
/** Captures the first-send task instead of running it, so a test decides when it runs. */
function capture() {
  const tasks: Array<() => Promise<void>> = [];
  return { tasks, schedule: (task: () => Promise<void>) => void tasks.push(task) };
}

test('retry delays double from 2 minutes', () => {
  assert.equal(retryDelayMs(1), OUTBOX_FIRST_RETRY_MS);
  assert.equal(retryDelayMs(2), 2 * OUTBOX_FIRST_RETRY_MS);
  assert.equal(retryDelayMs(4), 8 * OUTBOX_FIRST_RETRY_MS);
});

test('status flow: queued on enqueue, sent after the scheduled first send', async () => {
  const { rows, model } = fakeOutbox();
  const { provider, sent } = fakeProvider();
  const c = clock();
  const later = capture();

  const result = await enqueueNotification(model, { template: 'order_confirmed', to: 'ayesha@example.com', vars: VARS, dedupeKey: 'order_confirmed:o1' }, { provider, now: c.now, schedule: later.schedule, log: silent });
  assert.equal(result.outcome, 'queued');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.status, 'queued');
  assert.equal(rows[0]!.attempts, 0);
  assert.ok(rows[0]!.subject.includes('ORD-ABCD2345'));
  assert.equal(sent.length, 0, 'nothing is sent before the scheduled task runs');

  await later.tasks[0]!();
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.to, 'ayesha@example.com');
  assert.equal(rows[0]!.status, 'sent');
  assert.equal(rows[0]!.attempts, 1);
  assert.equal(rows[0]!.nextAttemptAt, null);
  assert.equal(rows[0]!.providerMessageId, 'msg-1');
});

test('the log provider keeps the message as skipped and sends nothing', async () => {
  const { rows, model } = fakeOutbox();
  const lines: string[] = [];
  const provider = createLogProvider((line) => void lines.push(line));
  const later = capture();
  await enqueueNotification(model, { template: 'order_confirmed', to: 'ayesha@example.com', vars: VARS }, { provider, schedule: later.schedule, log: silent });
  await later.tasks[0]!();
  assert.equal(rows[0]!.status, 'skipped');
  assert.equal(lines.length, 1);
  assert.equal(lines.join('').includes('ayesha@'), false, 'the address is not logged');
});

test('a provider failure is retried after the delay, then sent', async () => {
  const { rows, model } = fakeOutbox();
  const { provider, sent } = fakeProvider([{ ok: false, error: 'resend answered 503', retryable: true }]);
  const c = clock();
  const later = capture();
  await enqueueNotification(model, { template: 'order_confirmed', to: 'ayesha@example.com', vars: VARS }, { provider, now: c.now, schedule: later.schedule, log: silent });
  await later.tasks[0]!();

  assert.equal(rows[0]!.status, 'failed');
  assert.equal(rows[0]!.attempts, 1);
  assert.equal(rows[0]!.lastError, 'resend answered 503');
  assert.equal((rows[0]!.nextAttemptAt as Date).getTime(), c.now().getTime() + OUTBOX_FIRST_RETRY_MS);

  // Not due yet: the flush picks nothing.
  c.advance(OUTBOX_FIRST_RETRY_MS - 1000);
  assert.equal((await flushOutbox(model, { provider, now: c.now, log: silent })).picked, 0);

  c.advance(2000);
  const summary = await flushOutbox(model, { provider, now: c.now, log: silent });
  assert.equal(summary.picked, 1);
  assert.equal(summary.sent, 1);
  assert.equal(rows[0]!.status, 'sent');
  assert.equal(rows[0]!.attempts, 2);
  assert.equal(rows[0]!.lastError, null);
  assert.equal(sent.length, 2);
});

test('a row stops after the last attempt, and a permanent refusal stops at once', async () => {
  const { rows, model } = fakeOutbox();
  const failing: SendResult = { ok: false, error: 'timeout', retryable: true };
  const { provider, sent } = fakeProvider(Array.from({ length: 10 }, () => ({ ...failing })));
  const c = clock();
  await enqueueNotification(model, { template: 'order_confirmed', to: 'a@example.com', vars: VARS }, { provider, now: c.now, sendNow: false, log: silent });
  for (let i = 0; i < OUTBOX_MAX_ATTEMPTS + 2; i += 1) {
    await flushOutbox(model, { provider, now: c.now, log: silent });
    c.advance(60 * 60 * 1000);
  }
  assert.equal(sent.length, OUTBOX_MAX_ATTEMPTS);
  assert.equal(rows[0]!.attempts, OUTBOX_MAX_ATTEMPTS);
  assert.equal(rows[0]!.status, 'failed');
  assert.equal(rows[0]!.nextAttemptAt, null);

  const second = fakeOutbox();
  const refusing = fakeProvider([{ ok: false, error: 'resend answered 422: invalid to', retryable: false }]);
  await enqueueNotification(second.model, { template: 'order_confirmed', to: 'a@example.com', vars: VARS }, { provider: refusing.provider, now: c.now, sendNow: false, log: silent });
  const summary = await flushOutbox(second.model, { provider: refusing.provider, now: c.now, log: silent });
  assert.equal(summary.failed, 1);
  assert.equal(second.rows[0]!.nextAttemptAt, null);
});

test('two senders at once: the row is claimed by one, sent once', async () => {
  const { rows, model } = fakeOutbox();
  const { provider, sent } = fakeProvider();
  const c = clock();
  const result = await enqueueNotification(model, { template: 'order_confirmed', to: 'a@example.com', vars: VARS }, { provider, now: c.now, sendNow: false, log: silent });
  assert.equal(result.outcome, 'queued');
  const id = (result as { id: string }).id;

  const outcomes = await Promise.all([
    sendOutboxRow(model, id, provider, { now: c.now, log: silent }),
    sendOutboxRow(model, id, provider, { now: c.now, log: silent }),
    flushOutbox(model, { provider, now: c.now, log: silent }),
  ]);
  assert.equal(sent.length, 1);
  assert.equal(rows[0]!.attempts, 1);
  assert.ok(outcomes.includes('not_claimed'));
});

test('the same dedupeKey twice writes one row and answers duplicate', async () => {
  const { rows, model } = fakeOutbox();
  const { provider } = fakeProvider();
  const input = { template: 'order_confirmed' as const, to: 'a@example.com', vars: VARS, dedupeKey: 'order_confirmed:o1' };
  const first = await enqueueNotification(model, input, { provider, sendNow: false, log: silent });
  const second = await enqueueNotification(model, input, { provider, sendNow: false, log: silent });
  assert.equal(first.outcome, 'queued');
  assert.equal(second.outcome, 'duplicate');
  assert.equal((second as { id: string | null }).id, (first as { id: string }).id);
  assert.equal(rows.length, 1);
});

test('a missing or malformed recipient is skipped: nothing is written', async () => {
  const { rows, model } = fakeOutbox();
  for (const to of [null, undefined, '', '   ', 'not-an-email']) {
    const result = await enqueueNotification(model, { template: 'order_confirmed', to, vars: VARS }, { sendNow: false, log: silent });
    assert.equal(result.outcome, 'no_recipient', String(to));
  }
  assert.equal(rows.length, 0);
});

test('enqueue never throws: a database failure or a missing value is an outcome, not an exception', async () => {
  const down = fakeOutbox({ createFails: true });
  const logged: unknown[] = [];
  const result = await enqueueNotification(down.model, { template: 'order_confirmed', to: 'a@example.com', vars: VARS }, { sendNow: false, log: (_line, detail) => void logged.push(detail) });
  assert.equal(result.outcome, 'error');
  assert.equal(logged.length, 1);
  assert.equal(JSON.stringify(logged).includes('a@example.com'), false, 'the address is not logged');

  const ok = fakeOutbox();
  const missing = await enqueueNotification(ok.model, { template: 'order_dispatched', to: 'a@example.com', vars: VARS }, { sendNow: false, log: silent });
  assert.equal(missing.outcome, 'error');
  assert.equal(ok.rows.length, 0);
});

test('a provider that throws is a retryable failure, and a scheduler that throws leaves the row for the flush', async () => {
  const { rows, model } = fakeOutbox();
  const throwing: EmailProvider = {
    name: 'throwing',
    async send() {
      throw new Error('socket hang up');
    },
  };
  const result = await enqueueNotification(model, { template: 'order_confirmed', to: 'a@example.com', vars: VARS }, {
    provider: throwing,
    schedule: () => {
      throw new Error('after() was called outside a request scope');
    },
    log: silent,
  });
  assert.equal(result.outcome, 'queued');
  assert.equal(rows[0]!.status, 'queued');

  const outcome = await sendOutboxRow(model, rows[0]!._id, throwing, { log: silent });
  assert.equal(outcome, 'retry');
  assert.equal(rows[0]!.status, 'failed');
  assert.ok(String(rows[0]!.lastError).includes('socket hang up'));
});
