import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { NAV_GROUPS, homeFor, pageTitleFor, visibleNavGroups } from "../components/dashboard/nav-config";
import { auditExportHref } from "../lib/audit";
import { ADMIN_LEVEL_OPTIONS, inviteBody, inviteProblems, levelLabel, newPasswordProblem, reasonProblem, statusText, userActions } from "../lib/admin-users";
import { FLOW_ENDPOINTS, flowBody, flowProblems, readFlowAnswer, tokenShape } from "../lib/password-flow";

// Sprint 6 (S6-B6): the console follows the level (nav, users page, password flows, audit export). The server enforces; these are the pure parts.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.ADMIN_BACKEND_API_URL = "http://admin.test";
});

const SUPPORT = ["orders.read", "sellers.read", "tickets.read", "tickets.reply", "contact.read"];
const FINANCE = ["overview.read", "payments.read", "payments.decide", "payouts.manage", "commission.read", "commission.write", "plans.read"];
const hrefs = (caps: readonly string[] | null) => visibleNavGroups(caps).flatMap((g) => g.items.map((i) => i.href));

test("the navigation follows the capabilities: support sees orders, sellers, tickets and contact messages only, finance sees money pages, an owner sees everything", () => {
  assert.deepEqual(hrefs(SUPPORT), ["/orders", "/sellers", "/support", "/contact"]);
  assert.deepEqual(hrefs(FINANCE), ["/", "/subscriptions", "/subscription-payments", "/commission"]);
  const all = NAV_GROUPS.flatMap((g) => g.items).map((i) => i.href);
  assert.deepEqual(hrefs(null), all, "no session answer yet: everything (the server still decides)");
  const owner = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.capability)).filter(Boolean) as string[];
  assert.deepEqual(hrefs(owner), all);
  assert.ok(all.includes("/users"));
});

test("a group with no item left disappears, and every item declares a capability", () => {
  assert.equal(visibleNavGroups(SUPPORT).some((g) => g.label === "Platform"), false);
  assert.equal(visibleNavGroups([]).length, 0);
  for (const item of NAV_GROUPS.flatMap((g) => g.items)) assert.ok(item.capability, item.href + " needs a capability");
  assert.equal(pageTitleFor("/users"), "Admin users");
});

test("a level lands on the overview when it may read it, else on the first page it can use", () => {
  assert.equal(homeFor(FINANCE), "/");
  assert.equal(homeFor(SUPPORT), "/orders");
  assert.equal(homeFor(["sellers.read"]), "/sellers");
  assert.equal(homeFor([]), "/login");
});

test("level labels and the four options", () => {
  assert.deepEqual(ADMIN_LEVEL_OPTIONS.map((o) => o.value), ["owner", "finance", "operations", "customer_support"]);
  assert.equal(levelLabel("customer_support"), "Customer support");
  assert.equal(levelLabel("x"), "x");
});

test("a row offers no action on yourself or on the last active owner; others get level and disable (enable when disabled)", () => {
  const owner = { id: "o1", adminLevel: "owner", accountStatus: "active" } as const;
  const owner2 = { id: "o2", adminLevel: "owner", accountStatus: "active" } as const;
  const fin = { id: "f1", adminLevel: "finance", accountStatus: "active" } as const;
  const off = { id: "f2", adminLevel: "finance", accountStatus: "suspended" } as const;
  const list = [owner, fin, off];
  assert.deepEqual(userActions(owner, "someone", list), [], "the last active owner");
  assert.deepEqual(userActions(owner, "someone", [...list, owner2]), ["level", "disable"], "with a second owner");
  assert.deepEqual(userActions(fin, "f1", list), [], "yourself");
  assert.deepEqual(userActions(fin, "o1", list), ["level", "disable"]);
  assert.deepEqual(userActions(off, "o1", list), ["enable", "level"]);
});

test("the invite form names each problem and the body is trimmed and lower-cased; the reason has the contract's limits", () => {
  assert.deepEqual(inviteProblems({ name: "", email: "x", adminLevel: "" }), { name: "Enter a name.", email: "Enter a valid email address.", adminLevel: "Choose a level." });
  assert.deepEqual(inviteProblems({ name: "Ayesha", email: "a@b.test", adminLevel: "finance" }), {});
  assert.match(inviteProblems({ name: "<b>x</b>", email: "a@b.test", adminLevel: "finance" }).name ?? "", /plain text/);
  assert.deepEqual(inviteBody({ name: " Ayesha ", email: " A@B.TEST ", adminLevel: "finance" }), { name: "Ayesha", email: "a@b.test", adminLevel: "finance" });
  assert.equal(reasonProblem("ok"), "Give a reason of at least 3 characters.");
  assert.equal(reasonProblem("fine"), null);
  assert.match(reasonProblem("x".repeat(301)) ?? "", /at most 300/);
  assert.equal(statusText({ accountStatus: "active", accepted: false }), "Invited, not accepted yet");
  assert.equal(statusText({ accountStatus: "suspended", accepted: true }), "Disabled");
  assert.equal(newPasswordProblem("short", "short"), "The password must be at least 8 characters.");
  assert.equal(newPasswordProblem("long-enough-1", "different-1"), "The two passwords are not the same.");
  assert.equal(newPasswordProblem("long-enough-1", "long-enough-1"), null);
});

test("the password pages: the token must have the shape of a link token, the two passwords must match, forgot needs a valid email, and the body never carries the confirmation", () => {
  const token = "A".repeat(43);
  assert.equal(tokenShape(token), true);
  for (const bad of [null, "", "short", "has space " + "A".repeat(20), "A".repeat(201)]) assert.equal(tokenShape(bad as string | null), false);
  assert.deepEqual(flowProblems("forgot", { email: "a@b.test", password: "", confirm: "" }, null), {});
  assert.equal(flowProblems("forgot", { email: "nope", password: "", confirm: "" }, null).email, "Enter a valid email address.");
  assert.deepEqual(flowProblems("reset", { email: "", password: "long-enough-1", confirm: "long-enough-1" }, token), {});
  assert.ok(flowProblems("reset", { email: "", password: "long-enough-1", confirm: "long-enough-1" }, null).token);
  assert.equal(flowProblems("invite", { email: "", password: "long-enough-1", confirm: "other" }, token).confirm, "The two passwords are not the same.");
  assert.equal(flowProblems("invite", { email: "", password: "short", confirm: "short" }, token).password, "The password must be at least 8 characters.");
  assert.deepEqual(flowBody("forgot", { email: " A@B.TEST ", password: "", confirm: "" }, null), { email: "a@b.test" });
  assert.deepEqual(flowBody("reset", { email: "", password: "pw-pw-pw-1", confirm: "pw-pw-pw-1" }, token), { token, password: "pw-pw-pw-1" });
  assert.deepEqual(FLOW_ENDPOINTS, { forgot: "/api/password/forgot", reset: "/api/password/reset", invite: "/api/invite/accept" });
});

test("a flow answer: success is the page's text (forgot never says whether the account exists); a failure keeps the server's words and field", async () => {
  const ok = await readFlowAnswer("forgot", new Response("{}", { status: 200 }));
  assert.equal(ok.ok, true);
  assert.match(ok.message, /If that email has an admin account/);
  const bad = await readFlowAnswer("reset", new Response(JSON.stringify({ error: "This link is not valid any more.", code: "TOKEN_INVALID" }), { status: 400 }));
  assert.deepEqual([bad.ok, bad.message], [false, "This link is not valid any more."]);
  const field = await readFlowAnswer("invite", new Response(JSON.stringify({ error: "The password is not accepted.", field: "password" }), { status: 400 }));
  assert.equal(field.field, "password");
  assert.match((await readFlowAnswer("forgot", new Response(JSON.stringify({ error: "Too many attempts." }), { status: 429 }))).message, /Wait a little/);
  assert.equal((await readFlowAnswer("reset", new Response("nope", { status: 502 }))).message, "Something went wrong. Try again.");
});

test("the export link carries the page's filters and an optional range, and nothing else", () => {
  assert.equal(auditExportHref({ q: "", action: "" }), "/api/audit/export");
  assert.equal(auditExportHref({ q: "store", action: "store.suspend" }, { from: "2026-11-01", to: "2026-11-30" }), "/api/audit/export?q=store&action=store.suspend&from=2026-11-01&to=2026-11-30");
});

// ------------------------------------------------------------------------------------------------------------------ the routes

type Ctx = { params: Promise<{ id: string; action: string }> };
let publicPOST: (r: NextRequest) => Promise<Response>;
let invitePOST: (r: NextRequest) => Promise<Response>;
let exportGET: (r: NextRequest) => Promise<Response>;
let usersPOST: (r: NextRequest) => Promise<Response>;
let userActionPOST: (r: NextRequest, c: Ctx) => Promise<Response>;
before(async () => {
  process.env.ADMIN_BACKEND_API_URL = "http://admin.test";
  publicPOST = (await import("../app/api/password/forgot/route")).POST;
  invitePOST = (await import("../app/api/invite/accept/route")).POST;
  exportGET = (await import("../app/api/audit/export/route")).GET;
  usersPOST = (await import("../app/api/users/route")).POST;
  userActionPOST = (await import("../app/api/users/[id]/[action]/route")).POST;
});

function stub(status: number, payload: unknown, headers: Record<string, string> = {}): Array<{ url: string; init: RequestInit | undefined }> {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(typeof payload === "string" ? payload : JSON.stringify(payload), { status, headers: { "content-type": "application/json", ...headers } });
  }) as typeof fetch;
  return calls;
}
const post = (url: string, body: unknown, cookie = "markaz-admin-session=tok", extra: Record<string, string> = {}) =>
  new NextRequest("http://admin.local" + url, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...extra }, body: JSON.stringify(body) });

test("the public routes need no cookie, forward the body to the backend, keep its words, code, field and Retry-After, and refuse a cross-site post", async () => {
  const calls = stub(200, { ok: true, message: "sent" });
  assert.equal((await publicPOST(post("/api/password/forgot", { email: "a@b.test" }, ""))).status, 200);
  assert.equal(calls[0]!.url, "http://admin.test/api/admin/password/forgot");
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { email: "a@b.test" });
  stub(400, { error: "This link is not valid any more.", code: "TOKEN_INVALID" });
  const bad = await invitePOST(post("/api/invite/accept", { token: "A".repeat(43), password: "pw-pw-pw-1" }, ""));
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: "This link is not valid any more.", code: "TOKEN_INVALID" });
  stub(429, { error: "Too many attempts." }, { "retry-after": "60" });
  const limited = await publicPOST(post("/api/password/forgot", { email: "a@b.test" }, ""));
  assert.deepEqual([limited.status, limited.headers.get("retry-after")], [429, "60"]);
  const calls2 = stub(200, {});
  assert.equal((await publicPOST(post("/api/password/forgot", { email: "a@b.test" }, "", { origin: "https://evil.example", "sec-fetch-site": "cross-site" }))).status, 403);
  assert.equal(calls2.length, 0);
  stub(500, { error: "boom" });
  assert.equal((await publicPOST(post("/api/password/forgot", { email: "a@b.test" }, ""))).status, 502);
});

test("the users routes validate against the strict contract and forward only the known keys; a bad id or action is 404", async () => {
  const calls = stub(200, { user: {} });
  assert.equal((await usersPOST(post("/api/users", { name: "N", email: "N@X.test", adminLevel: "finance" }))).status, 200);
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { name: "N", email: "n@x.test", adminLevel: "finance" });
  for (const body of [{ name: "N", email: "x", adminLevel: "finance" }, { name: "N", email: "n@x.test", adminLevel: "god" }, { name: "N", email: "n@x.test", adminLevel: "finance", role: "admin" }]) {
    assert.equal((await usersPOST(post("/api/users", body))).status, 422, JSON.stringify(body));
  }
  const id = "65a000000000000000000003";
  assert.equal((await userActionPOST(post("/x", { adminLevel: "owner", reason: "Promoted" }), { params: Promise.resolve({ id, action: "level" }) })).status, 200);
  assert.equal(calls[1]!.url, "http://admin.test/api/admin/users/" + id + "/level");
  assert.equal((await userActionPOST(post("/x", { reason: "no" }), { params: Promise.resolve({ id, action: "disable" }) })).status, 422);
  assert.equal((await userActionPOST(post("/x", { reason: "Left", adminLevel: "owner" }), { params: Promise.resolve({ id, action: "disable" }) })).status, 422);
  assert.equal((await userActionPOST(post("/x", { reason: "Fine" }), { params: Promise.resolve({ id: "x", action: "disable" }) })).status, 404);
  assert.equal((await userActionPOST(post("/x", { reason: "Fine" }), { params: Promise.resolve({ id, action: "delete" }) })).status, 404);
  assert.equal(calls.length, 2);
});

test("the export route needs the session, forwards only the known filters, returns the CSV as it is, and keeps a refusal's status", async () => {
  const csv = "﻿\"Time\"\r\n";
  const calls = stub(200, csv, { "content-type": "text/csv; charset=utf-8", "x-export-truncated": "true" });
  const res = await exportGET(new NextRequest("http://admin.local/api/audit/export?q=store&action=store.suspend&from=2026-11-01&evil=1", { headers: { cookie: "markaz-admin-session=tok" } }));
  assert.equal(res.status, 200);
  assert.equal(calls[0]!.url, "http://admin.test/api/admin/audit/export?q=store&action=store.suspend&from=2026-11-01");
  assert.equal(res.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(res.headers.get("x-export-truncated"), "true");
  // Response.text() strips a UTF-8 BOM, so the bytes are compared: the file must come back exactly as it was sent, BOM included.
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [...new TextEncoder().encode(csv)]);
  assert.equal((await exportGET(new NextRequest("http://admin.local/api/audit/export"))).status, 401);
  stub(403, { error: "Forbidden" });
  assert.equal((await exportGET(new NextRequest("http://admin.local/api/audit/export", { headers: { cookie: "markaz-admin-session=tok" } }))).status, 403);
});
