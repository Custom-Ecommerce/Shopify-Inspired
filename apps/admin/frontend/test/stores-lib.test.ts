import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTION_COPY, availableActions, listStateToQuery, parseListState, validateReason } from "../lib/stores";
import { formatPercent, formatRelative, shortId } from "../lib/format";
import { STATUS_TONES, statusLabel, toneOf } from "../lib/status";

test("the list state is read from the URL, and unreadable values fall back to the defaults", () => {
  assert.deepEqual(parseListState(new URLSearchParams("page=3&q=%20looms%20&status=suspended")), { page: 3, q: "looms", status: "suspended" });
  assert.deepEqual(parseListState(new URLSearchParams("page=0&status=deleted")), { page: 1, q: "", status: "" });
  assert.deepEqual(parseListState(new URLSearchParams("page=abc")), { page: 1, q: "", status: "" });
  assert.equal(parseListState(new URLSearchParams("q=" + "a".repeat(300))).q.length, 100);
});

test("the query string leaves defaults out and can add the page size for the backend", () => {
  assert.equal(listStateToQuery({ page: 1, q: "", status: "" }), "");
  assert.equal(listStateToQuery({ page: 2, q: "a b", status: "active" }), "page=2&q=a+b&status=active");
  assert.equal(listStateToQuery({ page: 1, q: "", status: "" }, true), "limit=20");
});

test("governance actions follow the backend rules", () => {
  assert.deepEqual(availableActions("active"), ["suspend"]);
  assert.deepEqual(availableActions("suspended"), ["activate"]);
  assert.deepEqual(availableActions("pending"), ["activate"]);
  assert.deepEqual(availableActions("archived"), []);
  assert.equal(ACTION_COPY.suspend.target, "suspended");
  assert.equal(ACTION_COPY.activate.target, "active");
});

test("the reason is mandatory and bounded", () => {
  assert.match(validateReason("   ", 3, 500) ?? "", /at least 3/);
  assert.match(validateReason("ab", 3, 500) ?? "", /at least 3/);
  assert.equal(validateReason("  ok then  ", 3, 500), null);
  assert.match(validateReason("x".repeat(501), 3, 500) ?? "", /at most 500/);
});

test("every store status has a tone, and an unknown status is neutral", () => {
  for (const status of ["pending", "active", "suspended", "archived"]) assert.ok(STATUS_TONES[status], status);
  assert.equal(toneOf("active"), "success");
  assert.equal(toneOf("suspended"), "danger");
  assert.equal(toneOf("something-new"), "neutral");
  assert.equal(statusLabel("suspended"), "Suspended");
});

test("formatters: percent, short id, relative time", () => {
  assert.equal(formatPercent(5), "5%");
  assert.equal(formatPercent(7.5), "7.5%");
  assert.equal(formatPercent(7.256), "7.26%");
  assert.equal(shortId("65a000000000000000000010"), "00000010");
  const now = new Date("2026-10-11T12:00:00Z");
  assert.equal(formatRelative("2026-10-11T11:59:50Z", now), "just now");
  assert.equal(formatRelative("2026-10-08T12:00:00Z", now), "3 days ago");
  assert.equal(formatRelative(null, now), "-");
});
