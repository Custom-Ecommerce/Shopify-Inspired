import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { canConnect, canVerify, checkedText, dnsSteps, domainFailure, nextStepText, readDomainState } from "../lib/domain-view";

// S7-B5: the domain page's pure helpers, and the BFF routes that feed it.

const body = {
  domain: "shop.zara.pk",
  customDomainStatus: "pending",
  dnsRecords: [
    { type: "CNAME", name: "shop.zara.pk", value: "cname.markazify.com" },
    { type: "TXT", name: "_markazify-verify.shop.zara.pk", value: "mz-abc" },
    { type: "MX", name: "x", value: "y" },
  ],
  failureReason: null,
  failureMessage: null,
  checkedAt: null,
  vercelConfigured: false,
  planAllowsCustomDomain: true,
};

test("the state is read from the backend answer; an unknown record type is dropped", () => {
  const state = readDomainState(body);
  assert.ok(state);
  assert.equal(state!.domain, "shop.zara.pk");
  assert.equal(state!.status, "pending");
  assert.equal(state!.dnsRecords.length, 2);
  assert.equal(state!.vercelConfigured, false);
  assert.equal(state!.planAllowsCustomDomain, true);
});

test("an unusable answer is null, and a missing plan flag does not lock the page", () => {
  assert.equal(readDomainState(null), null);
  assert.equal(readDomainState({ customDomainStatus: "maybe" }), null);
  assert.equal(readDomainState([]), null);
  const state = readDomainState({ customDomainStatus: "unset", domain: null });
  assert.equal(state!.domain, null);
  assert.equal(state!.planAllowsCustomDomain, true);
  assert.deepEqual(state!.dnsRecords, []);
});

test("the next step says what to do for each status", () => {
  const base = readDomainState(body)!;
  assert.match(nextStepText({ ...base, status: "pending" }), /Add the records/);
  assert.match(nextStepText({ ...base, status: "failed" }), /Check now/);
  assert.match(nextStepText({ ...base, status: "verified" }), /https:\/\/shop\.zara\.pk/);
  assert.match(nextStepText({ ...base, status: "unset", domain: null }), /Type the domain/);
});

test("steps, the Check button and the connect form follow the domain and the plan", () => {
  const state = readDomainState(body)!;
  assert.equal(dnsSteps(state).length, 4);
  assert.deepEqual(dnsSteps({ ...state, domain: null, dnsRecords: [] }), []);
  assert.equal(canVerify(state), true);
  assert.equal(canVerify({ ...state, planAllowsCustomDomain: false }), false);
  assert.equal(canVerify({ ...state, domain: null, dnsRecords: [] }), false);
  assert.equal(canConnect({ ...state, planAllowsCustomDomain: false }), false);
  assert.equal(canConnect(state), true);
});

test("errors become plain words: plan, taken, invalid, rate limit, session", () => {
  assert.deepEqual(domainFailure(403, { code: "PLAN_LIMIT_REACHED", error: "x" }).upgrade, true);
  assert.equal(domainFailure(409, { code: "DOMAIN_TAKEN" }).field, "domain");
  assert.match(domainFailure(409, { code: "DOMAIN_TAKEN" }).message, /another store/);
  assert.equal(domainFailure(400, { code: "DOMAIN_INVALID", error: "Enter only the domain." }).message, "Enter only the domain.");
  assert.match(domainFailure(429, {}).message, /too many/);
  assert.match(domainFailure(401, {}).message, /sign in/);
  assert.match(domainFailure(500, null).message, /Something went wrong/);
});

test("the time of the last check is told in plain words", () => {
  const now = new Date("2026-11-14T10:00:00Z");
  assert.equal(checkedText(null, now), null);
  assert.equal(checkedText("nope", now), null);
  assert.equal(checkedText("2026-11-14T09:59:40Z", now), "Checked just now");
  assert.equal(checkedText("2026-11-14T09:55:00Z", now), "Checked 5 minutes ago");
  assert.equal(checkedText("2026-11-14T07:00:00Z", now), "Checked 3 hours ago");
  assert.equal(checkedText("2026-11-10T10:00:00Z", now), "Checked 4 days ago");
});

// ------------------------------------------------------------------------------------------------ BFF routes

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stub(status: number, payload: unknown) {
  const seen: Array<{ url: string; method: string; body: string | undefined }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), method: String(init?.method), body: typeof init?.body === "string" ? init.body : undefined });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return seen;
}

test("the BFF routes exist for the state, connect, verify and disconnect, and refuse a request with no session without calling the backend", async () => {
  const state = (await import("../app/api/proxy/domain/route")).GET;
  const connect = (await import("../app/api/proxy/domain/connect/route")).POST;
  const verify = (await import("../app/api/proxy/domain/verify/route")).POST;
  const disconnect = (await import("../app/api/proxy/domain/disconnect/route")).POST;
  const seen = stub(200, {});
  const init = { headers: { "content-type": "application/json" } };
  const results = [
    await state(new NextRequest("http://seller.local/api/proxy/domain", init)),
    await connect(new NextRequest("http://seller.local/api/proxy/domain/connect", { ...init, method: "POST", body: JSON.stringify({ domain: "shop.zara.pk" }) })),
    await verify(new NextRequest("http://seller.local/api/proxy/domain/verify", { ...init, method: "POST", body: JSON.stringify({ customDomainStatus: "verified" }) })),
    await disconnect(new NextRequest("http://seller.local/api/proxy/domain/disconnect", { ...init, method: "POST" })),
  ];
  for (const res of results) assert.equal(res.status, 401);
  assert.equal(seen.length, 0);
});
