import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

let GET: (request: NextRequest) => Promise<Response>;
const realFetch = globalThis.fetch;

before(async () => {
  process.env.ADMIN_BACKEND_API_URL = "http://admin.test";
  GET = (await import("../app/api/commission/report/route")).GET;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const csvRequest = (cookie?: string): NextRequest =>
  new NextRequest("http://admin.local/api/commission/report?storeId=65a000000000000000000001&period=30&format=csv", { headers: cookie ? { cookie } : {} });

test("the CSV download keeps the byte order mark and the Urdu bytes the backend sent (found by the Sprint 4 verification)", async () => {
  const body = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('"Store","Commission"\r\n"دکان","200"\r\n', "utf8")]);
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(body, { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="commission-report-x.csv"' } });
  }) as typeof fetch;
  const response = await GET(csvRequest("markaz-admin-session=tok"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/csv/);
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="commission-report-x.csv"');
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(bytes.equals(body), true);
  assert.match(calls[0] ?? "", /^http:\/\/admin\.test\/api\/admin\/commission\/report\?.*format=csv/);
});

test("no session cookie is 401 and the backend is not called", async () => {
  let called = 0;
  globalThis.fetch = (async () => {
    called += 1;
    return new Response("", { status: 200 });
  }) as typeof fetch;
  assert.equal((await GET(csvRequest())).status, 401);
  assert.equal(called, 0);
});
