/*
 * Sprint 7 (S7-B4): checks for the PLATFORM contact form (the marketing site): the body built for the seller backend, and the answer given back. The rule that
 * matters: success is answered ONLY when the seller backend says it stored the message. From packages/storefront-data run:
 *
 *   npx tsx test/platform-contact.check.ts        (or: pnpm test)
 */
import assert from "node:assert/strict";
import { PLATFORM_CONTACT_SCOPE, buildPlatformContactBody, platformContactAnswer } from "../src/domain/platform-contact";

const form = { name: "Visitor", email: "v@example.com", topic: "Sales inquiry", message: "I want a demo", consent: true, "bot-field": "" };

const checks: Array<[string, () => void | Promise<void>]> = [];
const check = (name: string, run: () => void | Promise<void>): void => {
  checks.push([name, run]);
};

check("the form becomes one body: the topic joins the message, the honeypot becomes website only when filled, consent is true", () => {
  const built = buildPlatformContactBody(form);
  assert.deepEqual(built, { ok: true, body: { name: "Visitor", email: "v@example.com", message: "Topic: Sales inquiry\n\nI want a demo", consent: true } });
  const bot = buildPlatformContactBody({ ...form, "bot-field": "http://spam.test" });
  assert.equal(bot.ok && bot.body.website, "http://spam.test");
  const noTopic = buildPlatformContactBody({ ...form, topic: "" });
  assert.equal(noTopic.ok && noTopic.body.message, "I want a demo");
  assert.equal(buildPlatformContactBody({ ...form, consent: "on" }).ok, true);
});

check("a form that cannot be sent names the field: no name, no email, no message, no consent, not an object", () => {
  for (const [patch, field] of [[{ name: " " }, "name"], [{ email: "" }, "email"], [{ message: "" }, "message"], [{ consent: false }, "consent"], [{ consent: undefined }, "consent"]] as Array<[Record<string, unknown>, string]>) {
    const built = buildPlatformContactBody({ ...form, ...patch });
    assert.equal(built.ok, false);
    if (!built.ok) assert.equal(built.field, field);
  }
  for (const raw of [null, "text", 5, [], undefined]) assert.equal(buildPlatformContactBody(raw).ok, false);
});

check("it only ever sends the fields the backend knows (no store, status or topic key)", () => {
  const built = buildPlatformContactBody({ ...form, store: "x", status: "closed", revision: 3 });
  assert.ok(built.ok);
  if (built.ok) assert.deepEqual(Object.keys(built.body).sort(), ["consent", "email", "message", "name"]);
});

check("SUCCESS only when the backend says it stored the message: { data: { received: true } } on a 2xx", () => {
  assert.deepEqual(platformContactAnswer(201, { data: { received: true } }), { status: 200, body: { success: true, message: "Message received" } });
  assert.deepEqual(platformContactAnswer(200, { data: { received: true } }).status, 200);
});

check("every other outcome is an ERROR, never success: a 2xx with another body, no body, a gateway error, a timeout, an unknown status", () => {
  for (const [status, payload] of [[200, {}], [200, null], [200, { data: { received: false } }], [201, { success: true }], [204, undefined], [500, { data: { received: true } }], [502, {}], [503, {}], [0, null], [404, {}], [302, {}]] as Array<[number, unknown]>) {
    const answer = platformContactAnswer(status, payload);
    assert.equal(answer.body.hasOwnProperty("success"), false, status + " " + JSON.stringify(payload));
    assert.ok(answer.status >= 400, status + " " + JSON.stringify(payload));
  }
});

check("a refusal keeps its field (400), the limiter is 429 with a Retry-After, anything else is 503 with a plain sentence", () => {
  assert.deepEqual(platformContactAnswer(400, { error: { code: "INVALID_REQUEST", message: "Enter a valid email address." }, field: "email" }), { status: 400, body: { error: "Enter a valid email address.", field: "email" } });
  assert.equal(platformContactAnswer(400, {}).status, 400);
  const limited = platformContactAnswer(429, { error: { code: "RATE_LIMITED" } }, "42");
  assert.equal(limited.status, 429);
  assert.equal(limited.retryAfter, 42);
  assert.equal(platformContactAnswer(429, { retryAfterSeconds: 3.2 }).retryAfter, 4);
  assert.equal(platformContactAnswer(429, {}).retryAfter, undefined);
  const down = platformContactAnswer(500, {});
  assert.equal(down.status, 503);
  assert.match((down.body as { error: string }).error, /could not send/);
});

check("the platform scope names the pseudo store the limiter and the signed address use", () => {
  assert.equal(PLATFORM_CONTACT_SCOPE, "platform");
});

void (async () => {
  for (const [name, run] of checks) {
    await run();
    console.log("ok - " + name);
  }
  console.log(checks.length + " checks passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
