import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CONTACT_MESSAGE_MAX, CONTACT_STATUSES, TICKET_STATUSES, TICKET_SUBJECT_MAX, TICKET_TEXT_MAX } from "@markaz/contracts";
import {
  CONTACT_STATUS_LIST,
  SUPPORT_LIMITS,
  TICKET_STATUS_LIST,
  closeTicket,
  contactStatusLabel,
  createTicket,
  emptyTicketForm,
  fetchContactMessages,
  fetchTicket,
  fetchUnreadCount,
  readList,
  readSupportFailure,
  replyProblem,
  replyToContact,
  replyToTicket,
  safeWaLink,
  isTicket,
  supportQuery,
  ticketFormProblems,
  ticketFormToPayload,
  ticketStatusLabel,
  unreadBadge,
} from "../lib/support";

// Sprint 7 (S7-B4): the seller's inbox and support tickets on the dashboard side. Pure helpers, the calls (a stubbed store fetch), the BFF routes' shape, the navigation.

const ID = "65a0000000000000000a0001";
const ticket = { id: ID, subject: "Payout", status: "open", revision: 0, orderRef: null, messageCount: 1, lastMessageAt: null, lastFrom: "seller", messages: [{ from: "seller", text: "<b>hi</b>", at: null, byId: ID }] };
const message = { id: ID, name: "Ayesha", email: "a@x.pk", phone: null, message: "Hello there", status: "new", revision: 0, replies: [], waLink: null, createdAt: null };

function stub(status: number, payload: unknown): { calls: Array<{ url: string; init?: RequestInit }>; fetch: (url: string, init?: RequestInit) => Promise<Response> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
    },
  };
}

test("the dashboard's limits and statuses are the contracts' (they cannot drift)", () => {
  assert.equal(SUPPORT_LIMITS.subject.max, TICKET_SUBJECT_MAX);
  assert.equal(SUPPORT_LIMITS.message.max, TICKET_TEXT_MAX);
  assert.equal(SUPPORT_LIMITS.reply.max, TICKET_TEXT_MAX);
  assert.equal(CONTACT_MESSAGE_MAX, 3000);
  assert.deepEqual([...CONTACT_STATUS_LIST], [...CONTACT_STATUSES]);
  assert.deepEqual([...TICKET_STATUS_LIST], [...TICKET_STATUSES]);
});

test("the unread badge is empty for none, a number, and 99+ for a lot", () => {
  assert.equal(unreadBadge(null), "");
  assert.equal(unreadBadge(0), "");
  assert.equal(unreadBadge(NaN), "");
  assert.equal(unreadBadge(7), "7");
  assert.equal(unreadBadge(100), "99+");
});

test("list queries carry only a known status and a page above 1", () => {
  assert.equal(supportQuery(CONTACT_STATUS_LIST, "", 1), "limit=20");
  assert.equal(supportQuery(CONTACT_STATUS_LIST, "new", 2), "status=new&page=2&limit=20");
  assert.equal(supportQuery(TICKET_STATUS_LIST, "bogus", 0), "limit=20");
});

test("the list envelope is read, and a wrong shape is refused", () => {
  const list = readList({ docs: [ticket, { nope: true }], page: 2, totalDocs: 41, totalPages: 3 }, isTicket);
  assert.equal(list?.docs.length, 1);
  assert.equal(list?.totalDocs, 41);
  assert.equal(readList({ docs: "x" }, isTicket), null);
  assert.equal(readList(null, isTicket), null);
});

test("a WhatsApp link is trusted only when it is a wa.me address", () => {
  assert.equal(safeWaLink("https://wa.me/923001234567?text=Hi%20there"), "https://wa.me/923001234567?text=Hi%20there");
  assert.equal(safeWaLink("https://evil.example/923001234567"), null);
  assert.equal(safeWaLink("javascript:alert(1)"), null);
  assert.equal(safeWaLink(undefined), null);
});

test("the ticket form checks its fields and sends a trimmed payload without a store", () => {
  assert.deepEqual(Object.keys(ticketFormProblems(emptyTicketForm())).sort(), ["message", "subject"]);
  assert.deepEqual(ticketFormProblems({ subject: "Payout late", message: "My payout has not arrived", orderRef: "" }), {});
  assert.ok(ticketFormProblems({ subject: "ok subject", message: "fine message", orderRef: "x".repeat(41) }).orderRef);
  assert.deepEqual(ticketFormToPayload({ subject: "  Payout late ", message: " Not arrived ", orderRef: "  " }), { subject: "Payout late", message: "Not arrived" });
  assert.deepEqual(ticketFormToPayload({ subject: "Payout late", message: "Not arrived", orderRef: " ORD-1 " }), { subject: "Payout late", message: "Not arrived", orderRef: "ORD-1" });
});

test("a reply needs text and at most 3000 characters", () => {
  assert.equal(replyProblem("  "), "Write a reply.");
  assert.equal(replyProblem("a".repeat(3001)), "The reply can be at most 3000 characters.");
  assert.equal(replyProblem("Thanks"), null);
});

test("a refusal keeps its words, its field, and flags a conflict or a closed ticket", () => {
  const conflict = readSupportFailure(409, { error: "Changed", code: "TICKET_REVISION_CONFLICT", field: "revision" });
  assert.equal(conflict.revisionConflict, true);
  assert.equal(conflict.field, "revision");
  assert.equal(readSupportFailure(409, { error: "Closed", code: "TICKET_CLOSED" }).closed, true);
  assert.equal(readSupportFailure(400, { details: [{ message: "Too short" }] }).message, "Too short");
  assert.equal(readSupportFailure(500, null).message, "That did not work. Please try again.");
});

test("the calls go to the same-origin BFF with the right method and body", async () => {
  let s = stub(200, { docs: [message], page: 1, totalDocs: 1, totalPages: 1 });
  const list = await fetchContactMessages(s.fetch, "new", 1);
  assert.equal(s.calls[0]!.url, "/api/dashboard/contactMessages?status=new&limit=20");
  assert.equal(list.ok && list.value.docs[0]!.name, "Ayesha");

  s = stub(200, { docs: [], page: 1, totalDocs: 5, totalPages: 1 });
  assert.equal(await fetchUnreadCount(s.fetch), 5);
  assert.equal(s.calls[0]!.url, "/api/dashboard/contactMessages?status=new&limit=1");
  s = stub(500, { error: "x" });
  assert.equal(await fetchUnreadCount(s.fetch), null, "an unread count that cannot be read shows nothing");

  s = stub(200, { message, channel: "whatsapp", whatsappLink: "https://wa.me/923001234567?text=Hi" });
  const reply = await replyToContact(s.fetch, ID, 0, "  Hi  ");
  assert.equal(s.calls[0]!.url, "/api/dashboard/contactMessages/" + ID + "/reply");
  assert.deepEqual(JSON.parse(String(s.calls[0]!.init!.body)), { revision: 0, text: "Hi" });
  assert.equal(reply.ok && reply.value.whatsappLink, "https://wa.me/923001234567?text=Hi");

  s = stub(201, ticket);
  const created = await createTicket(s.fetch, { subject: " Payout ", message: " Not arrived ", orderRef: "" });
  assert.equal(s.calls[0]!.init!.method, "POST");
  assert.deepEqual(JSON.parse(String(s.calls[0]!.init!.body)), { subject: "Payout", message: "Not arrived" });
  assert.equal(created.ok && created.value.id, ID);

  s = stub(200, ticket);
  await replyToTicket(s.fetch, ID, 3, "Thanks");
  assert.deepEqual(JSON.parse(String(s.calls[0]!.init!.body)), { revision: 3, text: "Thanks" });
  s = stub(200, ticket);
  await closeTicket(s.fetch, ID, 3);
  assert.equal(s.calls[0]!.url, "/api/dashboard/tickets/" + ID + "/close");
  assert.deepEqual(JSON.parse(String(s.calls[0]!.init!.body)), { revision: 3 });

  s = stub(404, { error: "Ticket not found" });
  const missing = await fetchTicket(s.fetch, ID);
  assert.equal(!missing.ok && missing.status, 404);
  s = stub(200, { odd: true });
  assert.equal((await fetchTicket(s.fetch, ID)).ok, false, "a wrong shape is an error, not a blank screen");
  const down = await fetchTicket(async () => {
    throw new Error("offline");
  }, ID);
  assert.equal(!down.ok && down.status, 0);
});

test("labels read well and an unknown status is shown as it is", () => {
  assert.equal(contactStatusLabel("replied"), "Replied");
  assert.equal(ticketStatusLabel("answered"), "Answered by support");
  assert.equal(ticketStatusLabel("weird"), "weird");
});

test("the navigation has Inbox and Support, each with a page, and the breadcrumb knows them", () => {
  const nav = readFileSync(resolve(process.cwd(), "components/dashboard/DashboardSidebar.tsx"), "utf8");
  assert.ok(nav.includes('href: "/inbox", label: "Inbox"') && nav.includes('href: "/support", label: "Support"'));
  assert.ok(nav.includes("unreadBadge"), "the unread count is shown beside Inbox");
  for (const rel of ["inbox/page.tsx", "support/page.tsx", "support/new/page.tsx", "support/[id]/page.tsx"]) {
    assert.equal(existsSync(resolve(process.cwd(), "app/(dashboard)/s/[storeId]", rel)), true, rel);
  }
  const crumbs = readFileSync(resolve(process.cwd(), "components/dashboard/shared/DashboardBreadcrumb.tsx"), "utf8");
  assert.ok(crumbs.includes('inbox: "Inbox"') && crumbs.includes('support: "Support"'));
});

test("the BFF routes keep the store out of the body, and the ticket routes need no store", () => {
  const read = (rel: string) => readFileSync(resolve(process.cwd(), "app/api/dashboard", rel), "utf8");
  for (const rel of ["contactMessages/route.ts", "contactMessages/[id]/route.ts", "contactMessages/[id]/reply/route.ts", "tickets/route.ts", "tickets/[id]/route.ts", "tickets/[id]/[action]/route.ts"]) {
    const source = read(rel);
    assert.ok(source.includes("bindStore: false"), rel + " must not add a store to the strict body");
    assert.ok(source.includes('auth: "dashboard"'), rel);
  }
  assert.ok(read("contactMessages/route.ts").includes('storeScope: "required"'));
  assert.ok(read("tickets/route.ts").includes('storeScope: "optional"'));
});

test("messages are shown as text, never as markup", () => {
  for (const rel of ["app/(dashboard)/s/[storeId]/inbox/page.tsx", "app/(dashboard)/s/[storeId]/support/[id]/page.tsx", "app/(dashboard)/s/[storeId]/support/page.tsx"]) {
    assert.equal(readFileSync(resolve(process.cwd(), rel), "utf8").includes("dangerouslySetInnerHTML"), false, rel);
  }
});
