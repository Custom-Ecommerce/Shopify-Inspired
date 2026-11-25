import { readPlanSettings } from '@/lib/platform-settings';
import { createSellerAlert, enqueueEmail, loadStoreNotifyInfo, runAfterResponse, sellerDashboardLink } from '@/lib/notifications';

/**
 * Sprint 7 (S7-B4): what happens AFTER a contact message is stored. Never before: the form answers success only once the message is in the database; these
 * jobs (the bell alert, the emails) are best effort and never change that answer.
 */

export interface StoredContact {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  message: string;
}

const clip = (text: string, max: number): string => (text.length <= max ? text : text.slice(0, max - 3) + '...');

/** One bell alert of the contact_message kind per new store message, and one email to the seller (unless they switched order emails off). */
export async function sendStoreContactNotices(storeId: string, contact: StoredContact): Promise<void> {
  const store = await loadStoreNotifyInfo(storeId);
  if (store === null) return;
  const link = sellerDashboardLink(storeId, '/inbox') ?? 'your Markazify inbox';
  if (store.ownerEmail !== null && store.emailNewOrder) {
    await enqueueEmail({
      template: 'contact_message_store',
      to: store.ownerEmail,
      vars: {
        storeName: store.name,
        contactName: contact.name,
        contactEmail: contact.email === '' ? 'not given' : contact.email,
        contactPhone: contact.phone ?? 'not given',
        contactMessage: clip(contact.message, 1500),
        dashboardLink: link,
      },
      dedupeKey: 'contact_store:' + contact.id,
    });
  }
  await createSellerAlert({
    store: storeId,
    kind: 'contact_message',
    title: 'New message from ' + clip(contact.name, 60),
    body: clip(contact.message, 200),
    link: '/inbox',
    dedupeKey: 'contact:' + contact.id,
  });
}

export function notifyStoreContact(storeId: string, contact: StoredContact): void {
  runAfterResponse('contact_message_store', () => sendStoreContactNotices(storeId, contact));
}

/** The platform's contact message goes to the support address of the platform settings (the one payment claims use). No address: it stays in the admin inbox. */
export async function sendPlatformContactNotice(contact: StoredContact): Promise<void> {
  const supportEmail = (await readPlanSettings()).supportEmail;
  if (supportEmail === null) return;
  await enqueueEmail({
    template: 'contact_message_platform',
    to: supportEmail,
    vars: { contactName: contact.name, contactEmail: contact.email, contactMessage: clip(contact.message, 1500) },
    dedupeKey: 'contact_platform:' + contact.id,
  });
}

export function notifyPlatformContact(contact: StoredContact): void {
  runAfterResponse('contact_message_platform', () => sendPlatformContactNotice(contact));
}

/** The store's answer, emailed to the shopper when they gave an email. */
export async function sendContactReply(storeId: string, contact: { id: string; name: string; email: string }, replyText: string, revision: number): Promise<void> {
  const store = await loadStoreNotifyInfo(storeId);
  if (store === null || contact.email === '') return;
  await enqueueEmail({
    template: 'contact_reply',
    to: contact.email,
    vars: { storeName: store.name, contactName: contact.name, replyText: clip(replyText, 3000) },
    dedupeKey: 'contact_reply:' + contact.id + ':' + revision,
  });
}

export function notifyContactReply(storeId: string, contact: { id: string; name: string; email: string }, replyText: string, revision: number): void {
  runAfterResponse('contact_reply', () => sendContactReply(storeId, contact, replyText, revision));
}
