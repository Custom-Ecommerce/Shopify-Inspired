import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESEND_API_URL,
  createResendProvider,
  createSmtpProvider,
  cronSecretMatches,
  providerFromEnv,
  type MailTransport,
} from '../src/index';

// Providers and the cron secret check. No network: fetch and the SMTP transport are fakes.

const MESSAGE = { to: 'ayesha@example.com', subject: 'Hello', text: 'Hi', html: '<p>Hi</p>' };
const KEY = 're_test_' + 'k'.repeat(24);

test('provider choice follows EMAIL_PROVIDER; missing settings never fall back to log silently', async () => {
  assert.equal(providerFromEnv({}).name, 'log');
  assert.equal(providerFromEnv({ EMAIL_PROVIDER: 'log' }).name, 'log');
  assert.equal(providerFromEnv({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: KEY, EMAIL_FROM: 'Shop <a@b.co>' }).name, 'resend');
  assert.equal(providerFromEnv({ EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.example.com', EMAIL_FROM: 'a@b.co' }).name, 'smtp');

  for (const env of [
    { EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'a@b.co' },
    { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: KEY },
    { EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'a@b.co' },
    { EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'h', SMTP_PORT: 'abc', EMAIL_FROM: 'a@b.co' },
    { EMAIL_PROVIDER: 'pigeon' },
  ]) {
    const provider = providerFromEnv(env);
    assert.equal(provider.name, 'unconfigured', JSON.stringify(env));
    const result = await provider.send(MESSAGE);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.retryable, true);
    assert.equal(JSON.stringify(result).includes(KEY), false, 'the key value is never in the reason');
  }
});

test('resend: one POST with the key in the Authorization header only', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = createResendProvider({
    apiKey: KEY,
    from: 'Shop <a@b.co>',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 });
    },
  });
  const result = await provider.send(MESSAGE);
  assert.deepEqual(result, { ok: true, status: 'sent', providerMessageId: 'email_1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, RESEND_API_URL);
  assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, 'Bearer ' + KEY);
  const body = JSON.parse(String(calls[0]!.init.body));
  assert.deepEqual(body.to, ['ayesha@example.com']);
  assert.equal(body.from, 'Shop <a@b.co>');
  assert.equal(String(calls[0]!.init.body).includes(KEY), false);
});

test('resend: 5xx and 429 can be retried, any other refusal cannot; a network error can', async () => {
  const answer = (status: number) =>
    createResendProvider({ apiKey: KEY, from: 'a@b.co', fetchImpl: async () => new Response(JSON.stringify({ message: 'nope' }), { status }) });
  for (const [status, retryable] of [[500, true], [503, true], [429, true], [422, false], [403, false]] as const) {
    const result = await answer(status).send(MESSAGE);
    assert.equal(result.ok, false, String(status));
    assert.equal(!result.ok && result.retryable, retryable, String(status));
  }
  const offline = createResendProvider({ apiKey: KEY, from: 'a@b.co', fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); } });
  const result = await offline.send(MESSAGE);
  assert.equal(!result.ok && result.retryable, true);
});

test('smtp: a 5xx response code is permanent, anything else is retried; the transport is made once', async () => {
  let made = 0;
  const failures: unknown[] = [Object.assign(new Error('mailbox unavailable'), { responseCode: 550 }), new Error('ECONNRESET')];
  const transport: MailTransport = {
    async sendMail() {
      const failure = failures.shift();
      if (failure) throw failure;
      return { messageId: '<m1@x>' };
    },
  };
  const provider = createSmtpProvider({ host: 'h', port: 587, user: 'u', pass: 'p', from: 'a@b.co' }, async () => {
    made += 1;
    return transport;
  });
  const first = await provider.send(MESSAGE);
  assert.equal(!first.ok && first.retryable, false);
  const second = await provider.send(MESSAGE);
  assert.equal(!second.ok && second.retryable, true);
  const third = await provider.send(MESSAGE);
  assert.deepEqual(third, { ok: true, status: 'sent', providerMessageId: '<m1@x>' });
  assert.equal(made, 1);
});

test('cron secret: refused when unset, short or wrong; accepted in x-cron-secret or as a bearer token', () => {
  const secret = 's'.repeat(32);
  const headers = (entries: Record<string, string>) => new Headers(entries);
  assert.equal(cronSecretMatches(headers({ 'x-cron-secret': secret }), undefined), false);
  assert.equal(cronSecretMatches(headers({ 'x-cron-secret': secret }), ''), false);
  assert.equal(cronSecretMatches(headers({ 'x-cron-secret': 'short' }), 'short'), false);
  assert.equal(cronSecretMatches(headers({}), secret), false);
  assert.equal(cronSecretMatches(headers({ 'x-cron-secret': secret + 'x' }), secret), false);
  assert.equal(cronSecretMatches(headers({ authorization: 'Bearer wrong' }), secret), false);
  assert.equal(cronSecretMatches(headers({ 'x-cron-secret': secret }), secret), true);
  assert.equal(cronSecretMatches(headers({ authorization: 'Bearer ' + secret }), secret), true);
});
