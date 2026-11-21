import type { EnqueueInput } from '@markaz/notifications';
import { enqueueEmail, runAfterResponse } from '@/lib/admin-account';
import { User } from '@/lib/workspace';

/**
 * Sprint 6 EP-12.US02.T03 (CO-82): the emails an operator's decision sends to a seller, queued at the moment of the change.
 *
 *   account_suspended     the seller account was suspended (the reason the operator gave)
 *   account_reactivated   the account was unsuspended
 *   store_paused          a store was suspended by an operator (CO-82's store_paused; the reason the operator gave)
 *
 * The builders are pure. Queueing runs after the response and never throws: a failed email never fails the status change that caused it
 * (the change is already audited). Each email has its own dedupe key, so a repeated call for the same change writes nothing.
 */

export const NOTICE_APP_NAME = 'Markazify';

export const noticeSteps = {
  run: runAfterResponse as (label: string, job: () => Promise<unknown>) => void,
  enqueue: enqueueEmail as (input: EnqueueInput) => Promise<unknown>,
  loadUser: async (id: string): Promise<{ name?: unknown; email?: unknown } | null> =>
    (await User.findById(id).select('name email').lean()) as unknown as { name?: unknown; email?: unknown } | null,
};

function cleanEmail(value: unknown): string | null {
  return typeof value === 'string' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim()) ? value.trim() : null;
}

/** The name the email greets. A seller without a name is greeted with a plain "there", never an empty hole. */
function greetingName(name: unknown): string {
  return typeof name === 'string' && name.trim() !== '' ? name.trim().slice(0, 80) : 'there';
}

export interface AccountNoticeInput {
  sellerId: string;
  status: 'active' | 'suspended';
  /** The operator's reason; required for a suspension. */
  reason: string | null;
  name: unknown;
  email: unknown;
  /** The time of the change: part of the dedupe key, so two separate suspensions each get an email. */
  at: Date;
}

/** The email for a seller account that was suspended or reactivated, or null when there is nobody to send it to. */
export function buildAccountNotice(input: AccountNoticeInput): EnqueueInput | null {
  const to = cleanEmail(input.email);
  if (to === null) return null;
  const stamp = String(input.at.getTime());
  if (input.status === 'suspended') {
    const reason = (input.reason ?? '').trim();
    if (reason === '') return null;
    return {
      template: 'account_suspended',
      to,
      vars: { appName: NOTICE_APP_NAME, customerName: greetingName(input.name), suspensionReason: reason },
      dedupeKey: 'account_suspended:' + input.sellerId + ':' + stamp,
    };
  }
  return {
    template: 'account_reactivated',
    to,
    vars: { appName: NOTICE_APP_NAME, customerName: greetingName(input.name) },
    dedupeKey: 'account_reactivated:' + input.sellerId + ':' + stamp,
  };
}

export interface StorePausedNoticeInput {
  storeId: string;
  storeName: string;
  reason: string;
  ownerEmail: unknown;
  at: Date;
}

/** The email to a store's owner when an operator pauses (suspends) the store, or null when there is nobody to send it to. */
export function buildStorePausedNotice(input: StorePausedNoticeInput): EnqueueInput | null {
  const to = cleanEmail(input.ownerEmail);
  const reason = input.reason.trim();
  if (to === null || reason === '' || input.storeName.trim() === '') return null;
  return {
    template: 'store_paused',
    to,
    vars: { storeName: input.storeName.trim(), suspensionReason: reason },
    store: input.storeId,
    dedupeKey: 'store_paused:' + input.storeId + ':' + input.at.getTime(),
  };
}

/** Queues the account email after the response. The seller's name and email were read with the change; nothing here throws. */
export function queueAccountNotice(input: AccountNoticeInput): void {
  try {
    const mail = buildAccountNotice(input);
    if (mail === null) return;
    noticeSteps.run('seller-account-notice', () => noticeSteps.enqueue(mail));
  } catch (err) {
    console.error('[admin-backend] could not queue the seller account email', err instanceof Error ? err.name : 'unknown');
  }
}

/** Queues the store paused email after the response: the owner's address is read then, with the store's owner id. Never throws. */
export function queueStorePausedNotice(input: { storeId: string; storeName: string; ownerId: unknown; reason: string; at: Date }): void {
  try {
    const ownerId = input.ownerId === null || input.ownerId === undefined ? '' : String(input.ownerId);
    if (ownerId === '') return;
    noticeSteps.run('store-paused-notice', async () => {
      const owner = await noticeSteps.loadUser(ownerId);
      const mail = buildStorePausedNotice({ storeId: input.storeId, storeName: input.storeName, reason: input.reason, ownerEmail: owner?.email, at: input.at });
      if (mail !== null) await noticeSteps.enqueue(mail);
    });
  } catch (err) {
    console.error('[admin-backend] could not queue the store paused email', err instanceof Error ? err.name : 'unknown');
  }
}
