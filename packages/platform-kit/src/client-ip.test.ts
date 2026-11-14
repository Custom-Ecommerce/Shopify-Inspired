import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { SOCKET_ADDRESS_HEADER, isSocketStampActive, resolveClientIp } from "./client-ip";
import { stampSocketAddresses } from "./socket-address";

const headers = (values: Record<string, string>) => new Headers(values);

describe("before the socket address is stamped", () => {
  it("does not believe a client that sends the stamp header itself", () => {
    assert.equal(isSocketStampActive(), false);
    assert.equal(resolveClientIp(headers({ [SOCKET_ADDRESS_HEADER]: "198.51.100.1" }), {}), null);
  });
});

describe("x-forwarded-for with a hop count", () => {
  const settings = { TRUSTED_PROXY_HOPS: "1" };

  it("takes the entry the nearest proxy wrote, not what the client sent", () => {
    assert.equal(resolveClientIp(headers({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" }), settings), "203.0.113.9");
    assert.equal(resolveClientIp(headers({ "x-forwarded-for": "1.1.1.1,2.2.2.2,203.0.113.9" }), settings), "203.0.113.9");
  });

  it("counts from the right with more hops", () => {
    assert.equal(resolveClientIp(headers({ "x-forwarded-for": "1.1.1.1, 203.0.113.9, 10.0.0.1" }), { TRUSTED_PROXY_HOPS: "2" }), "203.0.113.9");
  });

  it("does not use a header shorter than the hop count", () => {
    assert.equal(resolveClientIp(headers({ "x-forwarded-for": "1.1.1.1" }), { TRUSTED_PROXY_HOPS: "2" }), null);
  });

  it("refuses an entry that is not an address", () => {
    for (const bad of ["evil", "<script>", "1.1.1.1; drop", "a".repeat(100)]) {
      assert.equal(resolveClientIp(headers({ "x-forwarded-for": bad }), settings), null, bad);
    }
  });

  it("normalises an address: mapped IPv6, a port, IPv6 case", () => {
    assert.equal(resolveClientIp(headers({ "x-forwarded-for": "::ffff:203.0.113.9" }), settings), "203.0.113.9");
    assert.equal(resolveClientIp(headers({ "x-forwarded-for": "203.0.113.9:4431" }), settings), "203.0.113.9");
    assert.equal(resolveClientIp(headers({ "x-forwarded-for": "2001:DB8::1" }), settings), "2001:db8::1");
  });

  it("treats 0 and nonsense as no setting", () => {
    for (const hops of ["0", "-1", "two", "", "1.5"]) {
      assert.equal(resolveClientIp(headers({ "x-forwarded-for": "203.0.113.9" }), { TRUSTED_PROXY_HOPS: hops }), null, hops);
    }
  });
});

describe("a named trusted header", () => {
  it("is read, and x-forwarded-for beside it is not", () => {
    const seen = resolveClientIp(headers({ "x-real-ip": "203.0.113.5", "x-forwarded-for": "1.1.1.1" }), { TRUSTED_CLIENT_IP_HEADER: "X-Real-IP" });
    assert.equal(seen, "203.0.113.5");
  });

  it("wins over a hop count", () => {
    const seen = resolveClientIp(headers({ "x-real-ip": "203.0.113.5", "x-forwarded-for": "1.1.1.1" }), { TRUSTED_CLIENT_IP_HEADER: "x-real-ip", TRUSTED_PROXY_HOPS: "1" });
    assert.equal(seen, "203.0.113.5");
  });

  it("cannot be set to x-forwarded-for, which would be the raw header", () => {
    assert.equal(resolveClientIp(headers({ "x-forwarded-for": "1.1.1.1" }), { TRUSTED_CLIENT_IP_HEADER: "X-Forwarded-For" }), null);
  });
});

describe("with no setting", () => {
  it("ignores every forwarding header", () => {
    assert.equal(resolveClientIp(headers({ "x-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2" }), {}), null);
  });
});

describe("the socket address stamp", () => {
  let server: http.Server;
  let port = 0;

  before(async () => {
    stampSocketAddresses();
    stampSocketAddresses(); // A second call must not wrap it twice.
    server = http.createServer((request, response) => {
      response.end(JSON.stringify({ stamped: request.headers[SOCKET_ADDRESS_HEADER] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const ask = async (extra: Record<string, string>): Promise<string> => {
    const response = await fetch("http://127.0.0.1:" + port + "/", { headers: extra });
    return ((await response.json()) as { stamped: string }).stamped;
  };

  it("writes the connection's address on each request", async () => {
    assert.match(await ask({}), /127\.0\.0\.1$/);
  });

  it("replaces a value the client sent under the same name", async () => {
    assert.match(await ask({ [SOCKET_ADDRESS_HEADER]: "198.51.100.1" }), /127\.0\.0\.1$/);
  });

  it("is what resolveClientIp falls back to, whatever x-forwarded-for says", () => {
    const seen = resolveClientIp(headers({ [SOCKET_ADDRESS_HEADER]: "::ffff:127.0.0.1", "x-forwarded-for": "1.1.1.1" }), {});
    assert.equal(seen, "127.0.0.1");
  });

  it("backs up a hop count the request did not satisfy", () => {
    const seen = resolveClientIp(headers({ [SOCKET_ADDRESS_HEADER]: "203.0.113.7", "x-forwarded-for": "1.1.1.1" }), { TRUSTED_PROXY_HOPS: "2" });
    assert.equal(seen, "203.0.113.7");
  });
});
