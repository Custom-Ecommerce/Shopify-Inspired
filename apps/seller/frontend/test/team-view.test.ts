import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTION_DONE,
  ACTION_LABELS,
  MEMBER_ACTIONS,
  MEMBER_ROLES,
  actionsFor,
  hasFreeSeat,
  inviteProblems,
  isMemberAction,
  memberTitle,
  refusalFrom,
  removeConfirmText,
  roleName,
  seatText,
  statusText,
} from "../lib/team-view";

// Sprint 8 (S8-B4, D-118): the pure half of the Team page.

test("the roles offered are manager, staff and support (never owner)", () => {
  assert.deepEqual(MEMBER_ROLES.map((item) => item.value), ["manager", "staff", "support"]);
  assert.equal(roleName("manager"), "Manager");
  assert.equal(roleName("owner"), "Team member");
});

test("the status reads invited, expired, active or disabled", () => {
  assert.equal(statusText({ status: "invited", inviteExpired: false }), "Invited");
  assert.equal(statusText({ status: "invited", inviteExpired: true }), "Invitation expired");
  assert.equal(statusText({ status: "active", inviteExpired: false }), "Active");
  assert.equal(statusText({ status: "disabled", inviteExpired: false }), "Disabled");
});

test("a member is named by their name, or by their email when they have none yet", () => {
  assert.equal(memberTitle({ name: "Sana", email: "a@b.pk" }), "Sana");
  assert.equal(memberTitle({ name: null, email: "a@b.pk" }), "a@b.pk");
  assert.equal(memberTitle({ name: "  ", email: "a@b.pk" }), "a@b.pk");
});

test("each status offers its own actions: resend for an invite, disable for an active member, enable for a disabled one, remove for all", () => {
  assert.deepEqual(actionsFor("invited"), ["resend", "remove"]);
  assert.deepEqual(actionsFor("active"), ["disable", "remove"]);
  assert.deepEqual(actionsFor("disabled"), ["enable", "remove"]);
  for (const action of MEMBER_ACTIONS) {
    assert.ok(ACTION_LABELS[action]);
    assert.ok(ACTION_DONE[action]);
  }
});

test("only the four member actions are forwarded by the portal route", () => {
  for (const action of ["resend", "disable", "enable", "remove"]) assert.equal(isMemberAction(action), true);
  for (const value of ["invite", "delete", "", "../x", "Remove", null, undefined, 1]) assert.equal(isMemberAction(value), false, String(value));
});

test("the remove confirm says what happens to an invite and to a member", () => {
  assert.match(removeConfirmText({ name: null, email: "a@b.pk", status: "invited" }), /invitation for a@b\.pk is cancelled/);
  assert.match(removeConfirmText({ name: "Sana", email: "a@b.pk", status: "active" }), /^Sana loses access/);
});

test("the seat line reads '2 of 3 seats', and an invitation is offered only with a free seat", () => {
  assert.equal(seatText({ used: 2, limit: 3 }), "2 of 3 seats");
  assert.equal(seatText({ used: 0, limit: 1 }), "0 of 1 seat");
  assert.equal(seatText({ used: 1, limit: null }), "1 seat in use (no limit)");
  assert.equal(seatText({ used: 4, limit: null }), "4 seats in use (no limit)");
  assert.equal(hasFreeSeat({ used: 2, limit: 3 }), true);
  assert.equal(hasFreeSeat({ used: 3, limit: 3 }), false);
  assert.equal(hasFreeSeat({ used: 0, limit: 0 }), false);
  assert.equal(hasFreeSeat({ used: 50, limit: null }), true);
});

test("the invite form names the field that is wrong", () => {
  assert.deepEqual(inviteProblems({ email: " a@b.pk ", role: "staff" }), {});
  assert.deepEqual(Object.keys(inviteProblems({ email: "", role: "staff" })), ["email"]);
  assert.deepEqual(Object.keys(inviteProblems({ email: "nope", role: "staff" })), ["email"]);
  assert.deepEqual(Object.keys(inviteProblems({ email: "a@b.pk", role: "owner" })), ["role"]);
});

test("a plan limit refusal carries the upgrade hint; a field refusal carries the field; anything else a message", () => {
  const limit = refusalFrom({ error: "Your plan allows 1 team seat.", code: "PLAN_LIMIT_REACHED", details: { limitKind: "staffSeats", limit: 1, used: 1, plan: "Free", upgradeHint: "Upgrade to Pro." } });
  assert.deepEqual(limit, { message: "Your plan allows 1 team seat.", field: null, upgradeHint: "Upgrade to Pro." });
  assert.deepEqual(refusalFrom({ error: "That is your own address.", code: "OWNER_EMAIL", field: "email" }), { message: "That is your own address.", field: "email", upgradeHint: null });
  assert.deepEqual(refusalFrom(null, "Nope."), { message: "Nope.", field: null, upgradeHint: null });
});
