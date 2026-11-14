import { STOCK_WARNING_THRESHOLD } from '@/lib/contracts';
import { createSellerAlert, enqueueEmail, loadStoreNotifyInfo, runAfterResponse, sellerDashboardLink } from '@/lib/notifications';
import { Product, SellerAlert } from '@/lib/services';

/**
 * EP-07.US03.T02: low-stock and out-of-stock alerts. The threshold is the storefront's "Only N left" line
 * (STOCK_WARNING_THRESHOLD in @markaz/contracts, 5), so the seller is told exactly when shoppers start to see it.
 *
 *   1..threshold  one open low_stock alert per variant (key lowstock:<variantId>); an open out_of_stock alert is closed
 *   0             one open out_of_stock alert per variant (key outofstock:<variantId>)
 *   > threshold   every open stock alert of the variant is closed (open false, resolvedAt), so a later drop alerts again
 *
 * "One per variant" is the partial unique index on { store, dedupeKey } while open (models/seller-alert.ts): a second
 * create of the same open key fails with a duplicate key and is ignored, even when two sales land at once.
 */

export type StockLevelOutcome = 'none' | 'resolved' | 'low_stock' | 'out_of_stock' | 'duplicate';

/** The part of the SellerAlert model this needs. Tests pass a fake. */
export interface StockAlertModel {
  create(doc: Record<string, unknown>): PromiseLike<unknown>;
  updateMany(filter: Record<string, unknown>, update: Record<string, unknown>): PromiseLike<{ modifiedCount?: number } | unknown>;
}

export interface StockLevel {
  storeId: string;
  productId: string;
  variantId: string;
  quantity: number;
  productName: string;
}

const modifiedOf = (result: unknown): number => Number((result as { modifiedCount?: unknown } | null)?.modifiedCount ?? 0);

const isDuplicateKey = (err: unknown): boolean => typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;

async function closeOpen(model: StockAlertModel, level: StockLevel, kinds: string[], now: Date): Promise<number> {
  const result = await model.updateMany(
    { store: level.storeId, variantId: level.variantId, open: true, kind: { $in: kinds } },
    { $set: { open: false, resolvedAt: now } },
  );
  return modifiedOf(result);
}

/** Applies one new stock level to the variant's alerts. Throws only on a database error other than a duplicate. */
export async function applyStockLevel(
  model: StockAlertModel,
  level: StockLevel,
  now: Date = new Date(),
): Promise<{ outcome: StockLevelOutcome; alertId: string | null }> {
  const variantId = level.variantId.toLowerCase();
  const normalized = { ...level, variantId };

  if (level.quantity > STOCK_WARNING_THRESHOLD) {
    const closed = await closeOpen(model, normalized, ['low_stock', 'out_of_stock'], now);
    return { outcome: closed > 0 ? 'resolved' : 'none', alertId: null };
  }

  const out = level.quantity <= 0;
  if (!out) await closeOpen(model, normalized, ['out_of_stock'], now);

  const kind = out ? 'out_of_stock' : 'low_stock';
  try {
    const created = (await model.create({
      store: level.storeId,
      kind,
      title: out ? level.productName + ' is out of stock' : 'Only ' + level.quantity + ' left of ' + level.productName,
      body: out ? 'Shoppers cannot order it until you restock.' : 'Shoppers now see "Only ' + level.quantity + ' left".',
      link: '/inventory',
      readAt: null,
      dedupeKey: (out ? 'outofstock:' : 'lowstock:') + variantId,
      open: true,
      resolvedAt: null,
      product: level.productId,
      variantId,
    })) as { _id?: unknown } | null;
    return { outcome: kind, alertId: created?._id === undefined ? null : String(created._id) };
  } catch (err) {
    if (isDuplicateKey(err)) return { outcome: 'duplicate', alertId: null };
    throw err;
  }
}

/** True when a change could open or close an alert: it ends at or under the line, or it starts there. */
export function stockAlertRelevant(quantity: number, delta: number): boolean {
  return quantity <= STOCK_WARNING_THRESHOLD || quantity - delta <= STOCK_WARNING_THRESHOLD;
}

async function productName(storeId: string, productId: string, variantId: string): Promise<string> {
  const row = (await Product.findOne({ _id: productId, store: storeId }).select('title variants._id variants.title').lean()) as {
    title?: unknown;
    variants?: Array<{ _id: unknown; title?: unknown }>;
  } | null;
  const title = typeof row?.title === 'string' && row.title !== '' ? row.title : 'A product';
  const variant = row?.variants?.find((v) => String(v._id).toLowerCase() === variantId.toLowerCase());
  const variantTitle = typeof variant?.title === 'string' ? variant.title : '';
  return variantTitle !== '' && variantTitle !== 'Default' ? title + ' (' + variantTitle + ')' : title;
}

/** The whole step for one stock change: alert, and email when the seller has low-stock emails on. */
export async function handleStockLevel(storeId: string, productId: string, variantId: string, quantity: number): Promise<StockLevelOutcome> {
  const name = await productName(storeId, productId, variantId);
  const { outcome, alertId } = await applyStockLevel(SellerAlert as unknown as StockAlertModel, { storeId, productId, variantId, quantity, productName: name });
  if ((outcome !== 'low_stock' && outcome !== 'out_of_stock') || alertId === null) return outcome;

  const store = await loadStoreNotifyInfo(storeId);
  if (!store || !store.emailLowStock) return outcome;
  const template = outcome === 'low_stock' ? 'low_stock_seller' : 'out_of_stock_seller';
  await enqueueEmail({
    template,
    to: store.ownerEmail,
    vars: {
      storeName: store.name,
      productName: name,
      stockLeft: String(quantity),
      dashboardLink: sellerDashboardLink(storeId, '/inventory') ?? 'your Markazify dashboard',
    },
    store: storeId,
    // One email per alert: a new alert after a restock and a new drop gets its own email.
    dedupeKey: template + ':' + alertId,
  });
  return outcome;
}

/** Called for every recorded stock movement. Runs after the response, never throws, never delays the sale. */
export function notifyStockLevel(storeId: string, productId: string, variantId: string, quantity: number, delta: number): void {
  if (!stockAlertRelevant(quantity, delta)) return;
  runAfterResponse('stock_level', async () => {
    await handleStockLevel(storeId, productId, variantId, quantity);
  });
}
