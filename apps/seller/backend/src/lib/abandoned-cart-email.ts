import * as notificationsNs from '@markaz/notifications';
import { unwrapCjs } from '@/lib/cjs';
import { ABANDONED_CART_EMAIL_DELAY_MS } from '@/lib/contracts';
import { unsubscribeLink, unsubscribeSecret } from '@/lib/broadcast';
import { sellerPortalLink } from '@/lib/account-support';
import { unsubscribedAmong } from '@/lib/customers';
import { oid } from '@/lib/ledger-aggregates';
import { databaseReady, enqueueEmail, storefrontHomeLink } from '@/lib/notifications';
import { AbandonedCart, Store } from '@/lib/services';
import { readAbandonedCartEmail, readMessages } from '@/lib/store-settings';

const notifications: typeof notificationsNs = unwrapCjs(notificationsNs);

/*
 * Sprint 5 EP-28.US01.T05 (D-107): the OPTIONAL automatic email about a cart left behind. OFF by default: only stores that switched
 * abandonedCartEmail on (messages group) are looked at. The existing flush route calls queueAbandonedCartEmails() first and then sends what the
 * outbox holds, so no new scheduler exists. One email per cart, two hours after the shopper's last activity, only to a cart that is still open
 * (never a contacted or recovered one) with an email, never to an unsubscribed address, and always with the signed unsubscribe link (without
 * the signing secret or the portal address nothing is queued). The cart is claimed with one compare-and-set on { status open, emailQueuedAt null },
 * and the outbox key abandoned:<cartId> makes a second try a no-op.
 */

/** At most this many carts per flush call. */
export const ABANDONED_EMAIL_BATCH = 50;

export interface AbandonedEmailResult {
  /** Emails queued in the outbox. */
  queued: number;
  /** Carts retired without an email because the address had unsubscribed. */
  skippedUnsubscribed: number;
}

type Row = Record<string, unknown>;

/** Queues the due emails. Never throws; does nothing while no database connection is open. */
export async function queueAbandonedCartEmails(now: Date = new Date()): Promise<AbandonedEmailResult> {
  const result: AbandonedEmailResult = { queued: 0, skippedUnsubscribed: 0 };
  if (!databaseReady()) return result;
  try {
    const secret = unsubscribeSecret();
    if (secret === null || sellerPortalLink('/unsubscribe') === null) return result;

    // Only stores that switched the email on. A store with the switch off is never read further, so its carts cannot crowd out the others.
    const stores = (await Store.find({ status: 'active', 'paymentSettings.abandonedCartEmail': true })
      .select('name slug storefront paymentSettings')
      .lean()) as unknown as Row[];
    const byId = new Map<string, { id: string; name: string; slug: string; footer: string | null; link: string }>();
    for (const store of stores) {
      if (!readAbandonedCartEmail(store.paymentSettings)) continue;
      const slug = typeof store.slug === 'string' ? store.slug : '';
      const link = storefrontHomeLink(slug);
      if (link === null) continue;
      byId.set(String(store._id), { id: String(store._id), name: typeof store.name === 'string' ? store.name : 'Your store', slug, footer: readMessages(store.storefront).emailFooter, link });
    }
    if (byId.size === 0) return result;

    const due = (await AbandonedCart.find({
      store: { $in: [...byId.keys()].map((id) => oid(id)) },
      status: 'open',
      emailQueuedAt: null,
      email: { $ne: null },
      lastSeenAt: { $lte: new Date(now.getTime() - ABANDONED_CART_EMAIL_DELAY_MS) },
      expiresAt: { $gt: now },
    })
      .sort({ lastSeenAt: 1 })
      .limit(ABANDONED_EMAIL_BATCH)
      .lean()) as unknown as Row[];

    for (const cart of due) {
      const store = byId.get(String(cart.store));
      const email = typeof cart.email === 'string' ? cart.email : '';
      if (!store || email === '') continue;
      const unsubscribed = await unsubscribedAmong(store.id, [email]);
      // Claimed first: one winner per cart, and a cart that cannot be emailed is retired so it never blocks the queue.
      const claimed = await AbandonedCart.findOneAndUpdate({ _id: cart._id, status: 'open', emailQueuedAt: null }, { $set: { emailQueuedAt: now } }, { new: true }).lean();
      if (claimed === null) continue;
      if (unsubscribed.has(email.toLowerCase())) {
        result.skippedUnsubscribed += 1;
        continue;
      }
      const link = unsubscribeLink(store.id, email, secret);
      if (link === null) continue;
      const items = (Array.isArray(cart.items) ? (cart.items as Row[]) : []).map((item) => ({
        title: typeof item.productTitle === 'string' ? item.productTitle : 'Item',
        variantTitle: typeof item.variantTitle === 'string' ? item.variantTitle : null,
        quantity: Number(item.quantity ?? 1),
        unitPrice: Number(item.unitPrice ?? 0),
      }));
      const outcome = await enqueueEmail(
        {
          template: 'abandoned_cart',
          to: email,
          vars: { storeName: store.name, items: notifications.formatItems(items), total: notifications.formatRupees(Number(cart.total ?? 0)), storefrontLink: store.link, unsubscribeLink: link },
          store: store.id,
          dedupeKey: 'abandoned:' + String(cart._id),
          footer: store.footer,
        },
        { sendNow: false },
      );
      if (outcome.outcome === 'queued') result.queued += 1;
    }
  } catch (err) {
    console.error('[seller-backend] could not queue the abandoned cart emails', err instanceof Error ? err.name : 'unknown');
  }
  return result;
}
