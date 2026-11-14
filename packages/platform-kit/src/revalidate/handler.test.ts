import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleRevalidateRequest } from "./handler";
import { REVALIDATE_SECRET_HEADER, isAllowedRevalidateTag, storeResolveTag, storeTags } from "./tags";

const SECRET = "the-right-secret";
const STORE = "65a000000000000000000011";

function send(options: { secret?: string; url?: string; body?: unknown; raw?: string } = {}) {
  const purged: string[] = [];
  const request = new Request(options.url ?? "http://store.test/api/revalidate", {
    method: "POST",
    headers: { "content-type": "application/json", ...(options.secret === undefined ? {} : { [REVALIDATE_SECRET_HEADER]: options.secret }) },
    body: options.raw ?? JSON.stringify(options.body ?? { tags: [storeTags.products(STORE)] }),
  });
  return { purged, response: handleRevalidateRequest(request, { secret: SECRET, purge: (tag) => purged.push(tag) }) };
}

describe("the revalidate endpoint", () => {
  it("purges the tags sent with the right secret", async () => {
    const { purged, response } = send({ secret: SECRET, body: { tags: [storeTags.products(STORE), storeTags.categories(STORE)] } });
    const answer = await response;
    assert.equal(answer.status, 200);
    assert.deepEqual(purged, [storeTags.products(STORE), storeTags.categories(STORE)]);
    assert.deepEqual(await answer.json(), { revalidated: true, count: 2, tags: purged });
  });

  it("refuses a wrong or missing secret and purges nothing", async () => {
    for (const secret of ["wrong", "", undefined]) {
      const { purged, response } = send({ secret });
      assert.equal((await response).status, 401, String(secret));
      assert.deepEqual(purged, []);
    }
  });

  it("refuses the old query-string form, even with the right secret", async () => {
    const { purged, response } = send({ url: "http://store.test/api/revalidate?secret=" + SECRET + "&tag=products" });
    assert.equal((await response).status, 401);
    assert.deepEqual(purged, []);
  });

  it("refuses everything when no secret is configured", async () => {
    const answer = await handleRevalidateRequest(
      new Request("http://store.test/api/revalidate", { method: "POST", headers: { [REVALIDATE_SECRET_HEADER]: "anything" }, body: "{}" }),
      { secret: undefined, purge: () => assert.fail("must not purge") },
    );
    assert.equal(answer.status, 401);
  });

  it("refuses a bad body or a tag off the allow-list, and purges none of the batch", async () => {
    const notJson = send({ secret: SECRET, raw: "{nope" });
    assert.equal((await notJson.response).status, 400);
    const noTags = send({ secret: SECRET, body: {} });
    assert.equal((await noTags.response).status, 400);
    const badTag = send({ secret: SECRET, body: { tags: [storeTags.products(STORE), "store:x:layout"] } });
    assert.equal((await badTag.response).status, 400);
    assert.deepEqual(badTag.purged, []);
  });
});

describe("the tag map", () => {
  it("builds only tags the endpoint accepts", () => {
    for (const tag of [
      storeTags.static(STORE),
      storeTags.settings(STORE),
      storeTags.categories(STORE),
      storeTags.products(STORE),
      storeTags.product(STORE, "blue-cotton-shirt"),
      storeTags.product(STORE, "a".repeat(200)),
      storeResolveTag("alpha-store"),
    ]) {
      assert.equal(isAllowedRevalidateTag(tag), true, tag);
    }
  });
});
