import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { storeSettingsUpdateSchema, teamAcceptRequestSchema } from "@markaz/contracts";
import { SETTINGS_GROUPS } from "../lib/settings-groups";
import {
  ROLE_BLURBS,
  ROLE_NAMES,
  decideInviteView,
  inviteLoginHref,
  invitePath,
  inviteSignupHref,
  isInviteToken,
  nextAfterAuth,
  roleName,
  safeNextPath,
  type InviteInfo,
} from "../lib/invite-view";

// Sprint 8 (S8-B2, D-118): the accept-invite page. Its decision logic is pure; the page only renders it. The server decides everything that matters.

const TOKEN = "A".repeat(43);
const valid: InviteInfo = { valid: true, storeName: "Zara Lawn", role: "manager", email: "sara@example.pk" };
const input = (fields: Partial<Parameters<typeof decideInviteView>[0]> = {}) => decideInviteView({ token: TOKEN, info: valid, account: "none", accepted: null, ...fields });

test("a token has the shape of 32 random bytes in base64url (43 characters); nothing else is ever sent", () => {
  assert.equal(isInviteToken(TOKEN), true);
  assert.equal(isInviteToken("abc_-" + "B".repeat(38)), true);
  for (const bad of [null, undefined, "", "short", "A".repeat(42), "A".repeat(44), "A".repeat(42) + "=", "A".repeat(42) + " ", 7]) assert.equal(isInviteToken(bad), false, String(bad));
});

test("no token, a malformed token, or a server that says it is not valid is the one 'invalid' state: the page never says expired, used or cancelled", () => {
  assert.deepEqual(input({ token: null }), { kind: "invalid" });
  assert.deepEqual(input({ token: "nope" }), { kind: "invalid" });
  assert.deepEqual(input({ info: { valid: false } }), { kind: "invalid" });
  assert.deepEqual(input({ info: { valid: false }, account: "sara@example.pk" }), { kind: "invalid" });
});

test("loading while the invite or the account is being asked; an unreachable server is an error with a message", () => {
  assert.deepEqual(input({ info: null }), { kind: "loading" });
  assert.deepEqual(input({ account: null }), { kind: "loading" });
  const error = input({ info: "error" });
  assert.equal(error.kind, "error");
  assert.match(error.kind === "error" ? error.message : "", /reload/i);
});

test("valid and signed out: sign in or create the account with the invited email", () => {
  assert.deepEqual(input(), { kind: "sign_in", storeName: "Zara Lawn", role: "manager", email: "sara@example.pk" });
});

test("valid and signed in with the invited email (any case or spaces): ready to join", () => {
  assert.equal(input({ account: "sara@example.pk" }).kind, "ready");
  assert.equal(input({ account: "  SARA@Example.PK " }).kind, "ready");
});

test("valid and signed in with another account: the wrong account state names both addresses", () => {
  assert.deepEqual(input({ account: "other@example.pk" }), { kind: "wrong_account", storeName: "Zara Lawn", role: "manager", email: "sara@example.pk", signedInAs: "other@example.pk" });
});

test("accepted wins over everything else, and an invite refused by the server after the button turns into 'invalid'", () => {
  assert.deepEqual(input({ accepted: { storeName: "Zara Lawn", role: "staff" }, info: { valid: false }, account: "none" }), { kind: "accepted", storeName: "Zara Lawn", role: "staff" });
  assert.deepEqual(input({ account: "sara@example.pk", info: { valid: false } }), { kind: "invalid" });
});

test("the sign in and sign up links carry the invite path to come back to, and only that", () => {
  const back = encodeURIComponent("/accept-invite?token=" + TOKEN);
  assert.equal(invitePath(TOKEN), "/accept-invite?token=" + TOKEN);
  assert.equal(inviteLoginHref(TOKEN), "/login?next=" + back);
  assert.equal(inviteSignupHref(TOKEN), "/signup?next=" + back);
});

test("after sign in the page returns to the invite, and an open redirect is impossible: any other next is ignored", () => {
  const next = "/accept-invite?token=" + TOKEN;
  assert.equal(safeNextPath(next), next);
  assert.equal(nextAfterAuth("?next=" + encodeURIComponent(next)), next);
  assert.equal(nextAfterAuth(""), "/");
  for (const bad of [
    "https://evil.example/",
    "//evil.example",
    "/accept-invite?token=short",
    "/accept-invite?token=" + TOKEN + "&x=1",
    "/accept-invite/../admin?token=" + TOKEN,
    "/stores",
    "javascript:alert(1)",
    "/accept-invite?token=" + TOKEN + "\n",
    "",
    null,
    undefined,
  ]) {
    assert.equal(safeNextPath(bad), null, String(bad));
    assert.equal(nextAfterAuth("?next=" + encodeURIComponent(String(bad))), "/", String(bad));
  }
});

test("the roles are named and described in plain words, the manager's blurb says what stays with the owner", () => {
  assert.deepEqual(Object.keys(ROLE_NAMES).sort(), ["manager", "staff", "support"]);
  assert.equal(roleName("manager"), "Manager");
  assert.equal(roleName("owner"), "Team member");
  assert.equal(roleName(undefined), "Team member");
  for (const role of ["manager", "staff", "support"] as const) assert.ok(ROLE_BLURBS[role].startsWith(ROLE_NAMES[role]), role);
  assert.match(ROLE_BLURBS.manager, /payments/);
  assert.match(ROLE_BLURBS.manager, /team/);
});

test("the BFF: the accept route needs a session but resolves no store and binds none (the backend schema is strict); the invite info route is public", () => {
  const accept = readFileSync(join(process.cwd(), "app", "api", "team", "accept", "route.ts"), "utf8");
  assert.match(accept, /auth:\s*"token"/);
  assert.match(accept, /bindStore:\s*false/);
  assert.doesNotMatch(accept, /storeScope:\s*"required"/);
  const info = readFileSync(join(process.cwd(), "app", "api", "team", "invite", "route.ts"), "utf8");
  assert.match(info, /auth:\s*"none"/);
  // The body the page sends is exactly the strict contract: { token } and nothing else (a bound store would be a 400).
  assert.equal(teamAcceptRequestSchema.safeParse({ token: TOKEN }).success, true);
  assert.equal(teamAcceptRequestSchema.safeParse({ token: TOKEN, store: "65a000000000000000000011" }).success, false);
});

test("the link opens without a session: /accept-invite is a public page in the middleware", () => {
  const middleware = readFileSync(join(process.cwd(), "middleware.ts"), "utf8");
  assert.match(middleware, /PUBLIC_ACCOUNT_PAGES = \[[^\]]*'\/accept-invite'/);
});

test("the page decides through the pure function, builds no raw markup, and only ever sends the token to the two team routes", () => {
  const page = readFileSync(join(process.cwd(), "app", "accept-invite", "page.tsx"), "utf8");
  assert.match(page, /decideInviteView\(/);
  assert.equal(/dangerouslySetInnerHTML|innerHTML/.test(page), false);
  assert.match(page, /\/api\/team\/invite\?token=/);
  assert.match(page, /\/api\/team\/accept/);
  assert.match(page, /view\.kind === "wrong_account"/);
  assert.match(page, /view\.kind === "accepted"/);
  assert.match(page, /className="w-full"/, "buttons fill the card on a 375 px screen");
  assert.doesNotMatch(page, /console\.(log|info)/, "the token is never logged");
});

test("login and signup return to the invite page through nextAfterAuth (and to the dashboard otherwise)", () => {
  for (const file of ["login", "signup"]) {
    const source = readFileSync(join(process.cwd(), "app", file, "page.tsx"), "utf8");
    assert.match(source, /nextAfterAuth\(window\.location\.search\)/, file);
  }
});

test("the SB-6 guard still holds: no settings group was added here, and the portal allowlist equals the backend groups (tax included)", () => {
  const shape = (storeSettingsUpdateSchema as unknown as { shape: Record<string, unknown> }).shape;
  assert.deepEqual([...SETTINGS_GROUPS].sort(), Object.keys(shape).sort());
  assert.ok(SETTINGS_GROUPS.includes("tax"));
});
