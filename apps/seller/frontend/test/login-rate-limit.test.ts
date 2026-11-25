import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "../app/api/auth/login/route";
import { POST as signupPOST } from "../app/api/auth/signup/route";
import { tooManyAttemptsMessage } from "../lib/retry-after";

// SB-11 B (V-13): a locked-out seller is told how long to wait. The portal route passes Retry-After on; the page words it.
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const login = () =>
  POST(
    new NextRequest("http://seller.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.pk", password: "whatever-123" }),
    }),
  );

test("a 429 from the backend reaches the browser as a 429 with its Retry-After", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ errors: [{ message: "Too many attempts. Please wait and try again." }], code: "RATE_LIMITED" }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "660" },
    })) as typeof fetch;
  const res = await login();
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("retry-after"), "660");
  const body = (await res.json()) as { error: string; code: string };
  assert.equal(body.code, "RATE_LIMITED");
  assert.equal(tooManyAttemptsMessage(res.headers.get("retry-after")), "Too many attempts. Try again in about 11 minutes.");
});

test("a 429 without Retry-After is still a 429 and the message says about 1 minute", async () => {
  globalThis.fetch = (async () => new Response("{}", { status: 429, headers: { "content-type": "application/json" } })) as typeof fetch;
  const res = await login();
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("retry-after"), null);
  assert.equal(tooManyAttemptsMessage(res.headers.get("retry-after")), "Too many attempts. Try again in about 1 minute.");
});

test("a wrong password is still the same 401 message", async () => {
  globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
  const res = await login();
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "Invalid email or password." });
});

test("the wait is rounded up to whole minutes and a bad header falls back to one minute", () => {
  assert.equal(tooManyAttemptsMessage("1885"), "Too many attempts. Try again in about 32 minutes.");
  assert.equal(tooManyAttemptsMessage("60"), "Too many attempts. Try again in about 1 minute.");
  assert.equal(tooManyAttemptsMessage("abc"), "Too many attempts. Try again in about 1 minute.");
  assert.equal(tooManyAttemptsMessage(null), "Too many attempts. Try again in about 1 minute.");
});

test("SB-F1: the signup proxy sends the browser's signed address and passes the throttle's 429 and Retry-After on", async () => {
  const saved = { secret: process.env.CLIENT_ADDRESS_SIGNING_SECRET, hops: process.env.TRUSTED_PROXY_HOPS };
  process.env.CLIENT_ADDRESS_SIGNING_SECRET = "a".repeat(40);
  process.env.TRUSTED_PROXY_HOPS = "1";
  let sent: Record<string, string> = {};
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sent = init?.headers as Record<string, string>;
    return new Response(JSON.stringify({ errors: [{ message: "Too many attempts. Please wait and try again." }], code: "RATE_LIMITED" }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "1800" },
    });
  }) as typeof fetch;
  try {
    const res = await signupPOST(
      new NextRequest("http://seller.test/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.5" },
        body: JSON.stringify({ name: "Ali", email: "a@b.pk", password: "whatever-123" }),
      }),
    );
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("retry-after"), "1800");
    assert.equal(((await res.json()) as { code: string }).code, "RATE_LIMITED");
    assert.ok(sent["x-markaz-client-address"], "the address the portal signed is sent: " + Object.keys(sent).join());
  } finally {
    for (const [key, value] of [["CLIENT_ADDRESS_SIGNING_SECRET", saved.secret], ["TRUSTED_PROXY_HOPS", saved.hops]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
