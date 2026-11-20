import { after } from 'next/server';
import { buildSyncHeaders } from '@markaz/platform-kit/hmac';

/**
 * D-098 A2: tells the admin backend that a store went live, or asked to. The admin console reads its own copy of the
 * store, so without this call a store that went live in the seller database would stay pending there. Signed with the sync
 * key (the pattern of the billing bridge, in the other direction). Best effort: it runs after the response, never throws,
 * and logs without secrets. The admin route is idempotent, so a repeat is harmless.
 */
export const ADMIN_GO_LIVE_PATH = '/api/internal/stores/go-live';
const TIMEOUT_MS = 8000;

export interface GoLiveReport {
  storeId: string;
  /** active: the store is live. pending: the owner asked and waits for approval. */
  status: 'active' | 'pending';
  /** ISO time of the go-live request. */
  goLiveRequestedAt: string;
}

const inFlight = new Set<Promise<void>>();

/** Resolves once every call started so far has finished. For tests. */
export async function settleAdminCalls(): Promise<void> {
  while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
}

/** One signed call. Resolves true when the admin backend accepted it. Never throws. */
export async function sendGoLiveToAdmin(report: GoLiveReport): Promise<boolean> {
  try {
    let base = (process.env.ADMIN_BACKEND_API_URL ?? '').trim();
    while (base.endsWith('/')) base = base.slice(0, -1);
    const keyId = process.env.SYNC_KEY_ID_CURRENT ?? '';
    const secret = process.env.SYNC_SECRET_CURRENT ?? '';
    if (base === '' || keyId === '' || secret === '') {
      console.warn('[seller-backend] admin go-live call skipped: the admin bridge is not configured');
      return false;
    }
    const body = JSON.stringify(report);
    const response = await fetch(base + ADMIN_GO_LIVE_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...buildSyncHeaders({ keyId, secret, rawBody: body }) },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error('[seller-backend] admin go-live call refused', { storeId: report.storeId, status: response.status });
      return false;
    }
    return true;
  } catch (err) {
    console.error('[seller-backend] admin go-live call failed', { storeId: report.storeId, error: err instanceof Error ? err.name : 'unknown' });
    return false;
  }
}

/** Starts the call after the response (or at once outside a request). Never throws, never waits. */
export function notifyAdminStoreGoLive(report: GoLiveReport): void {
  const job = async (): Promise<void> => {
    await sendGoLiveToAdmin(report);
  };
  const run = (): void => {
    const promise = job().finally(() => inFlight.delete(promise));
    inFlight.add(promise);
  };
  try {
    after(run);
  } catch {
    run();
  }
}
