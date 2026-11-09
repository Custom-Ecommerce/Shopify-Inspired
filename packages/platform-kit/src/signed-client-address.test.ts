import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { INTERNAL_SIGNATURE_HEADER, INTERNAL_TIMESTAMP_HEADER } from "./internal-signature";
import {
  SIGNED_CLIENT_ADDRESS_HEADER,
  SIGNED_CLIENT_ADDRESS_MAX_AGE_MS,
  signedClientAddressHeaders,
  verifiedClientAddress,
} from "./signed-client-address";

const SECRET = "s".repeat(40);
const STORE = "65a000000000000000000011";
const OTHER_STORE = "65a000000000000000000012";
const NOW = 1_800_000_000_000;
const SHOPPER = "203.0.113.9";

const signed = (overrides: Record<string, string> = {}) => new Headers({ ...signedClientAddressHeaders(SECRET, STORE, SHOPPER, NOW), ...overrides });

describe("a signed client address", () => {
  it("is believed when the signature is valid and fresh", () => {
    assert.equal(verifiedClientAddress(signed(), SECRET, STORE, NOW), SHOPPER);
    assert.equal(verifiedClientAddress(signed(), SECRET, STORE, NOW + SIGNED_CLIENT_ADDRESS_MAX_AGE_MS), SHOPPER);
  });

  it("works for IPv6, kept in one form", () => {
    const headers = new Headers(signedClientAddressHeaders(SECRET, STORE, "2001:DB8::1", NOW));
    assert.equal(verifiedClientAddress(headers, SECRET, STORE, NOW), "2001:db8::1");
  });

  it("is refused when any header is missing", () => {
    for (const name of [SIGNED_CLIENT_ADDRESS_HEADER, INTERNAL_TIMESTAMP_HEADER, INTERNAL_SIGNATURE_HEADER]) {
      const headers = signed();
      headers.delete(name);
      assert.equal(verifiedClientAddress(headers, SECRET, STORE, NOW), null, name);
    }
    assert.equal(verifiedClientAddress(new Headers(), SECRET, STORE, NOW), null);
  });

  it("is refused when forged with another secret", () => {
    const forged = new Headers(signedClientAddressHeaders("f".repeat(40), STORE, SHOPPER, NOW));
    assert.equal(verifiedClientAddress(forged, SECRET, STORE, NOW), null);
  });

  it("is refused when the signature is made up", () => {
    assert.equal(verifiedClientAddress(signed({ [INTERNAL_SIGNATURE_HEADER]: "0".repeat(64) }), SECRET, STORE, NOW), null);
    assert.equal(verifiedClientAddress(signed({ [INTERNAL_SIGNATURE_HEADER]: "nonsense" }), SECRET, STORE, NOW), null);
  });

  it("is refused when the address is swapped for another", () => {
    assert.equal(verifiedClientAddress(signed({ [SIGNED_CLIENT_ADDRESS_HEADER]: "198.51.100.1" }), SECRET, STORE, NOW), null);
  });

  it("is refused when the timestamp is moved to look fresh", () => {
    assert.equal(verifiedClientAddress(signed({ [INTERNAL_TIMESTAMP_HEADER]: String(NOW + 1000) }), SECRET, STORE, NOW + 1000), null);
  });

  it("is refused when replayed after it has expired, or dated too far ahead", () => {
    assert.equal(verifiedClientAddress(signed(), SECRET, STORE, NOW + SIGNED_CLIENT_ADDRESS_MAX_AGE_MS + 1), null);
    assert.equal(verifiedClientAddress(signed(), SECRET, STORE, NOW - SIGNED_CLIENT_ADDRESS_MAX_AGE_MS - 1), null);
  });

  it("is refused on another store", () => {
    assert.equal(verifiedClientAddress(signed(), SECRET, OTHER_STORE, NOW), null);
  });

  it("is never believed with no usable secret on the backend", () => {
    assert.equal(verifiedClientAddress(signed(), "", STORE, NOW), null);
    assert.equal(verifiedClientAddress(signed(), "short", STORE, NOW), null);
  });

  it("sends nothing without a usable secret or address", () => {
    assert.deepEqual(signedClientAddressHeaders("", STORE, SHOPPER, NOW), {});
    assert.deepEqual(signedClientAddressHeaders("short", STORE, SHOPPER, NOW), {});
    assert.deepEqual(signedClientAddressHeaders(SECRET, STORE, null, NOW), {});
    assert.deepEqual(signedClientAddressHeaders(SECRET, STORE, "not an address", NOW), {});
  });
});
