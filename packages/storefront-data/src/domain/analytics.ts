import type { StorefrontEvent } from "@markaz/contracts/storefront-events";

/*
 * Sprint 8 (S8-B6, D-118): when and how the storefront counts something. Anonymous first-party counters: NO cookie, NO visitor id, nothing about the person is
 * sent. The body is the event and, for a product view, the product's slug; the server takes the store from the host.
 *
 * Nothing is sent: on a demo (no store), in a seller's preview, or when the browser says Do Not Track.
 *
 * A VISIT is one page_view per browser session of one store: a sessionStorage flag remembers that it was sent (a session is one tab until it is closed; a new
 * tab is a new visit). When sessionStorage cannot be used, no visit is counted rather than one per page.
 *
 * Fire and forget: nothing is awaited and every error is swallowed, so counting can never slow or break a page. Pure: the browser's parts are passed in.
 */

/** Matches BFF_BASE_PATH + "/events" (test/analytics.check.ts holds them together). */
export const EVENT_PATH = "/api/storefront/events";
export const VISIT_FLAG_PREFIX = "markaz-visit:";

export interface DoNotTrackSources {
  navigator?: { doNotTrack?: string | null; msDoNotTrack?: string | null } | null;
  window?: { doNotTrack?: string | null } | null;
}

export function doNotTrackOn(sources: DoNotTrackSources): boolean {
  return [sources.navigator?.doNotTrack, sources.navigator?.msDoNotTrack, sources.window?.doNotTrack].some((value) => value === "1" || value === "yes");
}

export interface VisitStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StoreTracker {
  /** Counts this browser session's visit, once. */
  visit(): void;
  track(event: Exclude<StorefrontEvent, "page_view">, productSlug?: string): void;
}

export const SILENT_TRACKER: StoreTracker = Object.freeze({ visit: () => undefined, track: () => undefined });

export interface TrackerOptions {
  /** The live store. Absent on a demo. */
  storeKey?: string;
  preview: boolean;
  doNotTrack: () => boolean;
  /** window.sessionStorage; may throw or be null. */
  storage: () => VisitStorage | null;
  send: (body: string) => unknown;
}

export function createStoreTracker(options: TrackerOptions): StoreTracker {
  const { storeKey } = options;
  if (!storeKey || options.preview) return SILENT_TRACKER;
  const post = (body: { event: StorefrontEvent; productSlug?: string }): void => {
    try {
      if (options.doNotTrack()) return;
      void Promise.resolve(options.send(JSON.stringify(body))).catch(() => undefined);
    } catch {
      // Counting never breaks a page.
    }
  };
  return {
    visit() {
      try {
        if (options.doNotTrack()) return;
        const storage = options.storage();
        const flag = VISIT_FLAG_PREFIX + storeKey;
        if (!storage || storage.getItem(flag) !== null) return;
        storage.setItem(flag, "1");
      } catch {
        return;
      }
      post({ event: "page_view" });
    },
    track(event, productSlug) {
      if (event === "product_view") {
        if (productSlug) post({ event, productSlug });
        return;
      }
      post({ event });
    },
  };
}

/** The browser's sender: keepalive so a page change does not drop it, and no cookie goes with it. */
export function browserSend(fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init)): (body: string) => Promise<unknown> {
  return (body) => fetchImpl(EVENT_PATH, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true, credentials: "omit" });
}

/** Runs once for each key a view shows: a re-render or a double effect sends nothing more. `sent` lives as long as the view. */
export function oncePerView(sent: { current: string | null }, key: string | null, run: () => void): void {
  if (key === null || sent.current === key) return;
  sent.current = key;
  run();
}
