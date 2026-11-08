import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { SignJWT } from 'jose';
import { HttpError } from '../src/lib/http';
import { PREVIEW_AUDIENCE, readPreviewLink, signPreviewLink } from '../src/lib/preview-token';

const SECRET = 'preview-test-secret-preview-test-secret';
const STORE_A = 'a'.repeat(24);
const STORE_B = 'b'.repeat(24);

const key = (secret: string): Uint8Array => new TextEncoder().encode(secret);

async function forged(claims: Record<string, unknown>, options: { audience?: string; subject?: string; expiresIn?: number; secret?: string } = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ purpose: 'preview', ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(options.subject ?? STORE_A)
    .setAudience(options.audience ?? PREVIEW_AUDIENCE)
    .setJti('test')
    .setIssuedAt(now - 100)
    .setExpirationTime(now + (options.expiresIn ?? 3600))
    .sign(key(options.secret ?? SECRET));
}

describe('preview links', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.PREVIEW_TOKEN_SECRET;
    process.env.PREVIEW_TOKEN_SECRET = SECRET;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.PREVIEW_TOKEN_SECRET;
    else process.env.PREVIEW_TOKEN_SECRET = saved;
  });

  it('a link opens the preview of its own store, and lasts 24 hours', async () => {
    const { token, expiresAt } = await signPreviewLink(STORE_A);
    assert.deepEqual(await readPreviewLink(token, STORE_A), { ok: true });
    const hours = (expiresAt.getTime() - Date.now()) / 3_600_000;
    assert.ok(hours > 23.9 && hours <= 24);
  });

  it('every click makes a different link', async () => {
    const first = await signPreviewLink(STORE_A);
    const second = await signPreviewLink(STORE_A);
    assert.notEqual(first.token, second.token);
  });

  it('a link for one store does not open another store', async () => {
    const { token } = await signPreviewLink(STORE_A);
    assert.deepEqual(await readPreviewLink(token, STORE_B), { ok: false });
  });

  it('an expired link, a changed link, another purpose, another audience and another secret are all refused', async () => {
    assert.deepEqual(await readPreviewLink(await forged({}, { expiresIn: -10 }), STORE_A), { ok: false });
    assert.deepEqual(await readPreviewLink(await forged({ purpose: 'login' }), STORE_A), { ok: false });
    assert.deepEqual(await readPreviewLink(await forged({}, { audience: 'seller-backend' }), STORE_A), { ok: false });
    assert.deepEqual(await readPreviewLink(await forged({}, { secret: 'another-secret-another-secret-another-secret' }), STORE_A), { ok: false });

    const { token } = await signPreviewLink(STORE_A);
    const [head, body, signature] = token.split('.');
    const changed = `${head}.${body?.slice(0, -2)}xx.${signature}`;
    assert.deepEqual(await readPreviewLink(changed, STORE_A), { ok: false });
  });

  it('junk is refused without an error', async () => {
    assert.deepEqual(await readPreviewLink('not a token', STORE_A), { ok: false });
    assert.deepEqual(await readPreviewLink(undefined, STORE_A), { ok: false });
    assert.deepEqual(await readPreviewLink('a.b.c', 'not-an-id'), { ok: false });
  });

  it('without a secret of at least 32 characters, signing is a 503 and reading is false', async () => {
    const { token } = await signPreviewLink(STORE_A);
    process.env.PREVIEW_TOKEN_SECRET = 'short';
    await assert.rejects(signPreviewLink(STORE_A), (err: unknown) => err instanceof HttpError && err.status === 503);
    assert.deepEqual(await readPreviewLink(token, STORE_A), { ok: false });
    delete process.env.PREVIEW_TOKEN_SECRET;
    await assert.rejects(signPreviewLink(STORE_A), (err: unknown) => err instanceof HttpError && err.status === 503);
  });
});
