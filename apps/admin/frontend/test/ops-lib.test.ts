import { test } from "node:test";
import assert from "node:assert/strict";
import { actionLabel, actorLabel, auditStateToQuery, entityHref, parseAuditListState } from "../lib/audit";
import { parseSellerListState, sellerStateToQuery } from "../lib/sellers";
import { STALE_PENDING_MS, parseSyncListState, syncHealth, syncStateToQuery } from "../lib/sync";
import { NAV_GROUPS } from "../components/dashboard/nav-config";
import { toneOf } from "../lib/status";

const OID = "65a000000000000000000010";

test("the seller list state is read from the URL, and unreadable values fall back", () => {
  assert.deepEqual(parseSellerListState(new URLSearchParams("page=3&q=%20aisha%20")), { page: 3, q: "aisha" });
  assert.deepEqual(parseSellerListState(new URLSearchParams("page=0&q=" + "a".repeat(300))).page, 1);
  assert.equal(parseSellerListState(new URLSearchParams("q=" + "a".repeat(300))).q.length, 100);
  assert.equal(sellerStateToQuery({ page: 1, q: "" }), "");
  assert.equal(sellerStateToQuery({ page: 2, q: "a b" }, true), "page=2&q=a+b&limit=20");
});

test("the sync list state defaults to dead letters, and the default stays out of the query", () => {
  assert.deepEqual(parseSyncListState(new URLSearchParams()), { page: 1, status: "dead" });
  assert.deepEqual(parseSyncListState(new URLSearchParams("status=sent&page=2")), { page: 2, status: "sent" });
  assert.equal(parseSyncListState(new URLSearchParams("status=failed")).status, "dead");
  assert.equal(syncStateToQuery({ page: 1, status: "dead" }), "");
  assert.equal(syncStateToQuery({ page: 3, status: "pending" }, true), "page=3&status=pending&limit=20");
});

test("outbox health: dead letters need attention, a stale pending event is a backlog, otherwise healthy", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  const fresh = new Date(now.getTime() - 60_000).toISOString();
  const stale = new Date(now.getTime() - STALE_PENDING_MS - 60_000).toISOString();
  assert.deepEqual(syncHealth({ pending: 0, sent: 5, dead: 2 }, null, now).tone, "danger");
  assert.match(syncHealth({ pending: 0, sent: 5, dead: 1 }, null, now).detail, /1 event could not/);
  assert.equal(syncHealth({ pending: 3, sent: 5, dead: 0 }, stale, now).tone, "warning");
  assert.equal(syncHealth({ pending: 3, sent: 5, dead: 0 }, fresh, now).label, "Healthy");
  assert.match(syncHealth({ pending: 3, sent: 5, dead: 0 }, fresh, now).detail, /3 events waiting/);
  assert.match(syncHealth({ pending: 0, sent: 5, dead: 0 }, null, now).detail, /Every event/);
});

test("the sync statuses have tones: sent is success, dead is danger, pending is a warning", () => {
  assert.equal(toneOf("sent"), "success");
  assert.equal(toneOf("dead"), "danger");
  assert.equal(toneOf("pending"), "warning");
});

test("the audit list state keeps a valid action only", () => {
  assert.deepEqual(parseAuditListState(new URLSearchParams("action=store.suspend&q=looms&page=2")), { page: 2, q: "looms", action: "store.suspend" });
  assert.equal(parseAuditListState(new URLSearchParams("action=%24ne")).action, "");
  assert.equal(auditStateToQuery({ page: 1, q: "", action: "" }), "");
  assert.equal(auditStateToQuery({ page: 2, q: "x", action: "store.suspend" }, true), "page=2&q=x&action=store.suspend&limit=20");
});

test("audit labels: known actions are named, actors are resolved, and a store target links to its page", () => {
  assert.equal(actionLabel("store.suspend"), "Store suspended");
  assert.equal(actionLabel("seller.something"), "seller.something");
  assert.equal(actorLabel({ id: OID, name: "Op Erator" }), "Op Erator");
  assert.equal(actorLabel({ id: OID, name: null }), "An operator (00000010)");
  assert.equal(actorLabel({ id: "system", name: null }), "system");
  assert.equal(actorLabel({ id: "", name: null }), "Unknown");
  assert.equal(entityHref("store", OID), "/stores/" + OID);
  assert.equal(entityHref("store", "nope"), null);
  assert.equal(entityHref("seller", OID), null);
});

test("the AF2 navigation items are live links", () => {
  const items = NAV_GROUPS.flatMap((group) => group.items);
  for (const href of ["/sellers", "/sync", "/audit"]) {
    const item = items.find((i) => i.href === href);
    assert.equal(item?.status, "live", href);
  }
});
