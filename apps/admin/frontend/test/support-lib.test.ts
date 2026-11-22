import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { NAV_GROUPS, visibleNavGroups } from "../components/dashboard/nav-config";
import { CONTACT_STATUSES, TICKET_STATUSES, changeTicketStatus, fetchContactMessages, fetchTicket, fetchTickets, parseSupportState, readSupportFailure, replyProblem, replyToTicket, supportStateToQuery } from "../lib/support";

// Sprint 7 (S7-B4): the admin support inbox: pure helpers, the client calls, the same-origin routes and the capability-gated navigation. The backend is stubbed.

const ID = "65a0000000000000000a0001";
const NOW = "2026-11-20T10:00:00.000Z";
const realFetch = globalThis.fetch;
const params = (query: string) => new URLSearchParams(query);

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.ADMIN_BACKEND_API_URL = "http://admin.test";
});

function stub(status: number, payload: unknown): Array<{ url: string; init: RequestInit | undefined }> {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

const ticket = { id: ID, subject: "Payout question", status: "open", revision: 0, messageCount: 1, lastMessageAt: NOW, lastFrom: "seller", orderRef: null, sellerName: "Zara", sellerEmail: "z@x.pk", messages: [{ from: "seller", text: "<b>hi</b>", at: NOW, byId: ID }] };

test("the list state is read from the URL with safe fallbacks and written back without defaults", () => {
  assert.deepEqual(parseSupportState(params(""), TICKET_STATUSES), { status: "", page: 1 });
  assert.deepEqual(parseSupportState(params("status=answered&page=3"), TICKET_STATUSES), { status: "answered", page: 3 });
  assert.deepEqual(parseSupportState(params("status=bogus&page=-2"), TICKET_STATUSES), { status: "", page: 1 });
  assert.deepEqual(parseSupportState(params("status=new"), CONTACT_STATUSES), { status: "new", page: 1 });
  assert.equal(supportStateToQuery({ status: "", page: 1 }), "limit=20");
  assert.equal(supportStateToQuery({ status: "open", page: 2 }), "status=open&page=2&limit=20");
});

test("a reply must have text and at most 3000 characters", () => {
  assert.equal(replyProblem("   "), "Write a reply.");
  assert.equal(replyProblem("a".repeat(3001)), "The reply can be at most 3000 characters.");
  assert.equal(replyProblem("Thanks"), null);
});

test("a refusal keeps its words and flags a version conflict or a closed ticket", () => {
  const conflict = readSupportFailure(409, { error: "Changed", code: "TICKET_REVISION_CONFLICT" });
  assert.equal(conflict.revisionConflict, true);
  assert.equal(conflict.message, "Changed");
  assert.equal(readSupportFailure(409, { error: "Closed", code: "TICKET_CLOSED" }).closed, true);
  assert.equal(readSupportFailure(500, null).message, "That did not work. Try again.");
});

test("the client lists, reads, replies and changes the status through the same-origin routes", async () => {
  let calls = stub(200, { docs: [ticket], page: 1, totalDocs: 1, totalPages: 1 });
  const list = await fetchTickets({ status: "open", page: 1 });
  assert.equal(calls[0]!.url, "/api/tickets?status=open&limit=20");
  assert.equal(list.ok && list.value.docs[0]!.subject, "Payout question");
  calls = stub(200, { ticket });
  assert.equal((await fetchTicket(ID)).ok, true);
  assert.equal(calls[0]!.url, "/api/tickets/" + ID);
  calls = stub(200, { ticket });
  await replyToTicket(ID, 0, "  Thanks  ");
  assert.equal(calls[0]!.url, "/api/tickets/" + ID + "/reply");
  assert.deepEqual(JSON.parse(String(calls[0]!.init!.body)), { revision: 0, text: "Thanks" });
  calls = stub(200, { ticket });
  await changeTicketStatus(ID, 1, "closed");
  assert.deepEqual(JSON.parse(String(calls[0]!.init!.body)), { revision: 1, status: "closed" });
  calls = stub(200, { docs: [], page: 1, totalDocs: 0, totalPages: 1 });
  await fetchContactMessages({ status: "", page: 1 });
  assert.equal(calls[0]!.url, "/api/contact-messages?limit=20");
  stub(409, { error: "Changed", code: "TICKET_REVISION_CONFLICT" });
  const refused = await replyToTicket(ID, 0, "x");
  assert.equal(!refused.ok && refused.failure.revisionConflict, true);
  stub(200, { unexpected: true });
  const odd = await fetchTicket(ID);
  assert.equal(!odd.ok && odd.failure.status, 502, "a wrong shape is an error, not a blank screen");
});

let listGET: (r: NextRequest) => Promise<Response>;
let detailGET: (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>;
let actionPOST: (r: NextRequest, c: { params: Promise<{ id: string; action: string }> }) => Promise<Response>;
let contactGET: (r: NextRequest) => Promise<Response>;
before(async () => {
  process.env.ADMIN_BACKEND_API_URL = "http://admin.test";
  listGET = (await import("../app/api/tickets/route")).GET;
  detailGET = (await import("../app/api/tickets/[id]/route")).GET;
  actionPOST = (await import("../app/api/tickets/[id]/[action]/route")).POST;
  contactGET = (await import("../app/api/contact-messages/route")).GET;
});
const cookie = { cookie: "markaz-admin-session=tok" };
const get = (p: string, headers: Record<string, string> = cookie) => new NextRequest("http://admin.local" + p, { headers });
const post = (p: string, body: unknown, headers: Record<string, string> = cookie) => new NextRequest("http://admin.local" + p, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });

test("the list routes forward only the known filters and need the session", async () => {
  const calls = stub(200, { docs: [] });
  assert.equal((await listGET(get("/api/tickets?status=open&page=2&limit=20&sellerEmail=a@b.c"))).status, 200);
  assert.equal(calls[0]!.url, "http://admin.test/api/admin/tickets?status=open&page=2&limit=20");
  assert.equal((await contactGET(get("/api/contact-messages?status=new&email=a@b.c"))).status, 200);
  assert.equal(calls[1]!.url, "http://admin.test/api/admin/contact-messages?status=new");
  assert.equal((await listGET(get("/api/tickets", {}))).status, 401);
  assert.equal(calls.length, 2);
});

test("the detail route refuses a bad id before the backend", async () => {
  const calls = stub(200, { ticket });
  assert.equal((await detailGET(get("/api/tickets/" + ID), { params: Promise.resolve({ id: ID }) })).status, 200);
  assert.equal(calls[0]!.url, "http://admin.test/api/admin/tickets/" + ID);
  assert.equal((await detailGET(get("/api/tickets/x"), { params: Promise.resolve({ id: "x" }) })).status, 404);
  assert.equal(calls.length, 1);
});

test("the reply and status routes validate the body, rebuild it, and forward only known keys", async () => {
  const calls = stub(200, { ticket });
  const ctx = (action: string) => ({ params: Promise.resolve({ id: ID, action }) });
  assert.equal((await actionPOST(post("/api/tickets/" + ID + "/reply", { revision: 0, text: "Thanks", admin: true }), ctx("reply"))).status, 200);
  assert.equal(calls[0]!.url, "http://admin.test/api/admin/tickets/" + ID + "/reply");
  assert.deepEqual(JSON.parse(String(calls[0]!.init!.body)), { revision: 0, text: "Thanks" });
  assert.equal((await actionPOST(post("/api/tickets/" + ID + "/status", { revision: 2, status: "closed" }), ctx("status"))).status, 200);
  assert.deepEqual(JSON.parse(String(calls[1]!.init!.body)), { revision: 2, status: "closed" });
  assert.equal((await actionPOST(post("/api/tickets/" + ID + "/reply", { revision: 0, text: "  " }), ctx("reply"))).status, 400);
  assert.equal((await actionPOST(post("/api/tickets/" + ID + "/reply", { text: "Hi" }), ctx("reply"))).status, 400);
  assert.equal((await actionPOST(post("/api/tickets/" + ID + "/status", { revision: 0, status: "deleted" }), ctx("status"))).status, 400);
  assert.equal((await actionPOST(post("/api/tickets/" + ID + "/purge", { revision: 0 }), ctx("purge"))).status, 404);
  assert.equal(calls.length, 2, "no refused request reached the backend");
});

test("support pages follow the capabilities: tickets.read shows Support, contact.read shows Contact, and both pages exist", () => {
  const hrefs = (caps: string[]) => visibleNavGroups(caps).flatMap((g) => g.items.map((i) => i.href));
  assert.deepEqual(hrefs(["tickets.read"]), ["/support"]);
  assert.deepEqual(hrefs(["contact.read"]), ["/contact"]);
  assert.deepEqual(hrefs(["tickets.reply"]), [], "replying alone does not show the page");
  const all = NAV_GROUPS.flatMap((g) => g.items);
  for (const href of ["/support", "/contact"]) {
    const item = all.find((i) => i.href === href);
    assert.ok(item && item.status === "live" && item.capability, href);
    assert.equal(fs.existsSync(path.join(process.cwd(), "app", "(dashboard)", href.slice(1), "page.tsx")), true);
  }
});

test("messages are shown as text, never as markup", () => {
  for (const file of ["components/support/support-view.tsx", "components/support/contact-view.tsx"]) {
    const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    assert.equal(source.includes("dangerouslySetInnerHTML"), false, file);
  }
});
