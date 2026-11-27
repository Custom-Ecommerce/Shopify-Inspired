import { errorText, recipientDomain } from './errors';
import { providerFromEnv } from './providers/select';
import { renderTemplate, type TemplateName, type TemplateVars } from './templates';
import { redactPushTokens, type PushApp, type PushChannel } from './push';
import type { EmailProvider, OutboxStatus, SendResult } from './types';

/**
 * The notification outbox (D-091). Every message is a row first; it is sent after the business action is saved, and
 * nothing here ever throws to the caller. The functions take the outbox model as an argument, so any backend (seller or
 * admin) can use them with its own connection, and tests pass a fake.
 *
 * Claiming a row to send it is ONE compare-and-set: { _id, status queued|failed, attempts < max, nextAttemptAt <= now }
 * moves nextAttemptAt a lease ahead and counts the attempt. A second sender (the immediate send and a flush, or two
 * flushes) then finds nothing to claim, so a row is never sent twice by two runs. If a process dies mid-send the lease
 * runs out and the row becomes due again.
 */

export const OUTBOX_MAX_ATTEMPTS = 5;
/** The wait after the first failure; it doubles after each further one (2, 4, 8, 16 minutes). */
export const OUTBOX_FIRST_RETRY_MS = 2 * 60 * 1000;
/** How long a claimed row is held before another sender may take it. Longer than any provider timeout. */
export const OUTBOX_SEND_LEASE_MS = 5 * 60 * 1000;
export const OUTBOX_FLUSH_BATCH = 50;

/** The delay before the next try, after `attempts` tries have failed (attempts >= 1). */
export function retryDelayMs(attempts: number): number {
  const n = Math.max(1, Math.floor(attempts));
  return OUTBOX_FIRST_RETRY_MS * 2 ** (n - 1);
}

/** A query the outbox calls lean() on. Mongoose queries are thenables, so PromiseLike is enough. */
interface LeanQuery<T> {
  lean(): PromiseLike<T>;
}

interface ListQuery {
  sort(spec: Record<string, 1 | -1>): ListQuery;
  limit(n: number): ListQuery;
  lean(): PromiseLike<unknown[]>;
}

/** The part of the NotificationOutbox Mongoose model the outbox uses. Pass the model cast to this type. */
export interface NotificationOutboxModel {
  create(doc: Record<string, unknown>): PromiseLike<unknown>;
  findOne(filter: Record<string, unknown>): LeanQuery<unknown>;
  find(filter: Record<string, unknown>): ListQuery;
  findOneAndUpdate(filter: Record<string, unknown>, update: Record<string, unknown>, options: { new: boolean }): LeanQuery<unknown>;
}

export interface OutboxRow {
  _id: unknown;
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  template: string;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  /** Missing on rows from before: email. */
  channel?: string;
  payload?: { data?: Record<string, string> };
}

export type OutboxLog = (line: string, detail?: Record<string, unknown>) => void;

const defaultLog: OutboxLog = (line, detail) => console.error(line, detail ?? {});

export interface EnqueueInput {
  template: TemplateName;
  /** The recipient. Empty or not an address: nothing is written (a missing customer email is skipped, D-091). */
  to: string | null | undefined;
  vars: TemplateVars;
  store?: string | null;
  order?: string | null;
  /** Unique when set: a second enqueue with the same key writes nothing and returns the first row. */
  dedupeKey?: string | null;
  /** The store's own footer, added to the email (EP-07.US02.T02). Only order emails to customers pass it. */
  footer?: string | null;
}

export interface OutboxOptions {
  /** Defaults to providerFromEnv(). */
  provider?: EmailProvider;
  /** Injected by tests. */
  now?: () => Date;
  log?: OutboxLog;
  /** Sprint 9: how push rows are sent. Without it a push row is left untouched for a sender that has one. */
  push?: PushChannel;
}

export interface EnqueueOptions extends OutboxOptions {
  /**
   * Runs the first send once the caller's own work is done. A route passes next/server after(); the default starts it
   * without waiting. Whatever it is, a failure inside it is caught and logged.
   */
  schedule?: (task: () => Promise<void>) => void;
  /** false: only write the row, and let the flush route send it. */
  sendNow?: boolean;
}

export type EnqueueResult =
  | { outcome: 'queued'; id: string }
  | { outcome: 'duplicate'; id: string | null }
  | { outcome: 'no_recipient' }
  | { outcome: 'error' };

export type SendOutcome = 'sent' | 'skipped' | 'retry' | 'failed' | 'not_claimed' | 'error';

const EMAIL_SHAPE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

const idOf = (doc: unknown): string => String((doc as { _id?: unknown } | null)?._id ?? '');

/**
 * Writes one message to the outbox and, unless sendNow is false, schedules its first send. Never throws: every problem is
 * logged (no secrets, no message body, only the recipient's domain) and answered as an outcome.
 */
export async function enqueueNotification(model: NotificationOutboxModel, input: EnqueueInput, options: EnqueueOptions = {}): Promise<EnqueueResult> {
  const log = options.log ?? defaultLog;
  try {
    const to = typeof input.to === 'string' ? input.to.trim() : '';
    if (to === '' || to.length > 254 || !EMAIL_SHAPE.test(to)) return { outcome: 'no_recipient' };

    const rendered = renderTemplate(input.template, input.vars, { footer: input.footer ?? null });
    const now = (options.now ?? (() => new Date()))();
    const dedupeKey = input.dedupeKey ? input.dedupeKey : undefined;

    let id: string;
    try {
      const created = await model.create({
        channel: 'email',
        to,
        template: input.template,
        payload: input.vars,
        subject: rendered.subject,
        bodyText: rendered.text,
        bodyHtml: rendered.html,
        status: 'queued',
        attempts: 0,
        nextAttemptAt: now,
        lastError: null,
        store: input.store ?? null,
        order: input.order ?? null,
        // Left out, not null, when there is none: the unique index is sparse.
        ...(dedupeKey === undefined ? {} : { dedupeKey }),
      });
      id = idOf(created);
    } catch (err) {
      if (dedupeKey !== undefined && isDuplicateKeyError(err)) {
        const existing = await model.findOne({ dedupeKey }).lean();
        return { outcome: 'duplicate', id: existing ? idOf(existing) : null };
      }
      throw err;
    }

    if (options.sendNow !== false && id !== '') {
      const provider = options.provider ?? providerFromEnv();
      const task = async (): Promise<void> => {
        await sendOutboxRow(model, id, provider, { now: options.now, log });
      };
      const guarded = (): Promise<void> =>
        task().catch((err: unknown) => log('[notifications] scheduled send failed', { id, error: errorText(err) }));
      const schedule: (run: () => Promise<void>) => void =
        options.schedule ??
        ((run: () => Promise<void>) => {
          void run();
        });
      try {
        schedule(guarded);
      } catch (err) {
        // after() outside a request scope throws: the flush route will send it instead.
        log('[notifications] could not schedule the first send; the flush will send it', { id, error: errorText(err) });
      }
    }
    return { outcome: 'queued', id };
  } catch (err) {
    log('[notifications] could not queue a message', { template: input.template, toDomain: recipientDomain(String(input.to ?? '')), error: errorText(err) });
    return { outcome: 'error' };
  }
}

export interface EnqueuePushInput {
  /** The push token of one phone. */
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  app: PushApp;
  kind: string;
  dedupeKey: string;
  store?: string | null;
  order?: string | null;
}

/**
 * Sprint 9 (EP-31.US02.T02): writes one push as an outbox row (channel 'push') and schedules its first send, exactly like an email: the same claim, the
 * same retries, one row per dedupeKey. Never throws.
 */
export async function enqueuePush(model: NotificationOutboxModel, input: EnqueuePushInput, options: EnqueueOptions & { push: PushChannel }): Promise<EnqueueResult> {
  const log = options.log ?? defaultLog;
  try {
    if (input.to === '' || input.to.length > 254) return { outcome: 'no_recipient' };
    const now = (options.now ?? (() => new Date()))();
    const text = input.body.slice(0, 200);
    let id: string;
    try {
      const created = await model.create({
        channel: 'push',
        to: input.to,
        template: 'push_' + input.kind,
        payload: { app: input.app, kind: input.kind, data: input.data },
        subject: input.title.slice(0, 80),
        bodyText: text,
        bodyHtml: text,
        status: 'queued',
        attempts: 0,
        nextAttemptAt: now,
        lastError: null,
        store: input.store ?? null,
        order: input.order ?? null,
        dedupeKey: input.dedupeKey.slice(0, 200),
      });
      id = idOf(created);
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        const existing = await model.findOne({ dedupeKey: input.dedupeKey.slice(0, 200) }).lean();
        return { outcome: 'duplicate', id: existing ? idOf(existing) : null };
      }
      throw err;
    }
    if (options.sendNow !== false && id !== '') {
      const provider = options.provider ?? providerFromEnv();
      const guarded = (): Promise<void> =>
        sendOutboxRow(model, id, provider, { now: options.now, log, push: options.push }).then(
          () => undefined,
          (err: unknown) => log('[notifications] scheduled send failed', { id, error: redactPushTokens(errorText(err)) }),
        );
      try {
        (options.schedule ?? ((run: () => Promise<void>) => void run()))(guarded);
      } catch (err) {
        log('[notifications] could not schedule the first send; the flush will send it', { id, error: errorText(err) });
      }
    }
    return { outcome: 'queued', id };
  } catch (err) {
    log('[notifications] could not queue a push', { kind: input.kind, error: redactPushTokens(errorText(err)) });
    return { outcome: 'error' };
  }
}

/**
 * Claims one row (the compare-and-set above), asks the provider to send it and records the result. A failure is
 * retried with a doubling delay until OUTBOX_MAX_ATTEMPTS tries; a refusal the provider calls permanent is final at once.
 * Never throws.
 */
export async function sendOutboxRow(model: NotificationOutboxModel, id: string, provider: EmailProvider, options: OutboxOptions = {}): Promise<SendOutcome> {
  const log = options.log ?? defaultLog;
  const clock = options.now ?? (() => new Date());
  let row: OutboxRow | null;
  try {
    const now = clock();
    row = (await model
      .findOneAndUpdate(
        { _id: id, status: { $in: ['queued', 'failed'] }, attempts: { $lt: OUTBOX_MAX_ATTEMPTS }, nextAttemptAt: { $lte: now } },
        { $set: { nextAttemptAt: new Date(now.getTime() + OUTBOX_SEND_LEASE_MS) }, $inc: { attempts: 1 } },
        { new: true },
      )
      .lean()) as OutboxRow | null;
  } catch (err) {
    log('[notifications] could not claim an outbox row', { id, error: errorText(err) });
    return 'error';
  }
  if (!row) return 'not_claimed';

  const isPush = row.channel === 'push';
  if (isPush && !options.push) {
    // Nobody here can send a push: give the claim back, so a sender with a push channel finds the row due and unspent.
    try {
      await model.findOneAndUpdate({ _id: id, attempts: row.attempts }, { $set: { nextAttemptAt: clock() }, $inc: { attempts: -1 } }, { new: true }).lean();
    } catch (err) {
      log('[notifications] could not release a push row', { id, error: errorText(err) });
    }
    return 'not_claimed';
  }

  let result: SendResult;
  let deadToken = false;
  const providerName = isPush ? options.push!.client.name : provider.name;
  try {
    if (isPush) {
      const sent = await options.push!.client.send({ to: row.to, title: row.subject, body: row.bodyText, data: row.payload?.data ?? {} });
      deadToken = !sent.ok && sent.deadToken === true;
      result = sent.ok ? { ok: true, status: 'sent', providerMessageId: sent.ticketId ?? null } : { ok: false, error: redactPushTokens(sent.error), retryable: sent.retryable && !deadToken };
    } else {
      result = await provider.send({ to: row.to, subject: row.subject, text: row.bodyText, html: row.bodyHtml });
    }
  } catch (err) {
    result = { ok: false, error: redactPushTokens(errorText(err)), retryable: true };
  }
  if (deadToken) {
    // The token is removed from its phone; the row is final and never retried.
    try {
      await options.push!.onDeadToken(row.to);
    } catch (err) {
      log('[notifications] could not remove a dead push token', { id, error: redactPushTokens(errorText(err)) });
    }
  }

  const attempts = Number(row.attempts) || 1;
  const finishedAt = clock();
  let outcome: SendOutcome;
  let set: Record<string, unknown>;
  if (result.ok) {
    outcome = result.status;
    set = {
      status: result.status,
      nextAttemptAt: null,
      lastError: null,
      provider: providerName,
      sentAt: result.status === 'sent' ? finishedAt : null,
      providerMessageId: result.status === 'sent' ? result.providerMessageId ?? null : null,
    };
  } else {
    const final = !result.retryable || attempts >= OUTBOX_MAX_ATTEMPTS;
    outcome = final ? 'failed' : 'retry';
    set = {
      status: 'failed',
      lastError: errorText(result.error),
      provider: providerName,
      nextAttemptAt: final ? null : new Date(finishedAt.getTime() + retryDelayMs(attempts)),
    };
    log(isPush ? '[notifications] push not sent' : '[notifications] email not sent', { id, template: row.template, provider: providerName, attempts, final, error: errorText(result.error) });
  }

  try {
    // Only this claim's result is written: if the lease ran out and another sender claimed the row, attempts moved on.
    await model.findOneAndUpdate({ _id: id, attempts: row.attempts }, { $set: set }, { new: true }).lean();
  } catch (err) {
    log('[notifications] could not record a send result', { id, error: errorText(err) });
    return 'error';
  }
  return outcome;
}

export interface FlushSummary {
  picked: number;
  sent: number;
  skipped: number;
  retry: number;
  failed: number;
  notClaimed: number;
  errors: number;
}

/**
 * Sends the queued and failed rows that are due, oldest first, at most `batch` of them. Each row is claimed on its own,
 * so two flushes running at once share the work instead of sending twice. Throws only when the due rows cannot be read.
 */
export async function flushOutbox(model: NotificationOutboxModel, options: OutboxOptions & { batch?: number } = {}): Promise<FlushSummary> {
  const provider = options.provider ?? providerFromEnv();
  const now = (options.now ?? (() => new Date()))();
  const batch = Math.min(Math.max(1, Math.floor(options.batch ?? OUTBOX_FLUSH_BATCH)), OUTBOX_FLUSH_BATCH);
  const due = await model
    .find({ status: { $in: ['queued', 'failed'] }, attempts: { $lt: OUTBOX_MAX_ATTEMPTS }, nextAttemptAt: { $lte: now } })
    .sort({ nextAttemptAt: 1 })
    .limit(batch)
    .lean();
  const rows = options.push ? due : due.filter((row) => (row as { channel?: unknown }).channel !== 'push');

  const summary: FlushSummary = { picked: rows.length, sent: 0, skipped: 0, retry: 0, failed: 0, notClaimed: 0, errors: 0 };
  for (const row of rows) {
    const outcome = await sendOutboxRow(model, idOf(row), provider, options);
    if (outcome === 'sent') summary.sent += 1;
    else if (outcome === 'skipped') summary.skipped += 1;
    else if (outcome === 'retry') summary.retry += 1;
    else if (outcome === 'failed') summary.failed += 1;
    else if (outcome === 'not_claimed') summary.notClaimed += 1;
    else summary.errors += 1;
  }
  return summary;
}
