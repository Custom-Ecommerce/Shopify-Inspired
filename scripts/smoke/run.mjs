// Smoke checks against already-running apps (Sprint 4 SB-9, D-102). This script starts nothing.
//
//   SELLER_BACKEND_URL=http://127.0.0.1:4001 ADMIN_BACKEND_URL=http://127.0.0.1:4010 STOREFRONT_URL=http://127.0.0.1:3000 \
//   MONGODB_URI=<a THROWAWAY database> node scripts/smoke/run.mjs
//
// It refuses to run unless the database the apps are using is a throwaway one: MONGODB_URI (and SELLER_MONGODB_URI, if set)
// must contain the word "throwaway" or "test". The value is never printed. The checks only send requests that must be
// refused or that read nothing, so they write nothing to the database.

const TIMEOUT_MS = 15_000;

function fail(message) {
  console.error(message);
  process.exit(2);
}

function guardDatabase() {
  const values = [process.env.MONGODB_URI, process.env.SELLER_MONGODB_URI].filter((v) => typeof v === 'string' && v.trim() !== '');
  if (values.length === 0) fail('Refusing to run: set MONGODB_URI to the throwaway database the apps use (its value is never printed).');
  for (const value of values) {
    if (!/throwaway|test/i.test(value)) {
      fail('Refusing to run: the database URI does not contain "throwaway" or "test". Use a throwaway database.');
    }
  }
}

function baseUrl(name) {
  const raw = (process.env[name] ?? '').trim();
  if (raw === '') fail('Refusing to run: ' + name + ' is not set.');
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
    return url.origin;
  } catch {
    return fail('Refusing to run: ' + name + ' is not a valid http(s) URL.');
  }
}

async function call(method, url, { body, headers } = {}) {
  const res = await fetch(url, {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* not JSON */
  }
  return { status: res.status, json };
}

async function main() {
  guardDatabase();
  const seller = baseUrl('SELLER_BACKEND_URL');
  const admin = baseUrl('ADMIN_BACKEND_URL');
  const storefront = baseUrl('STOREFRONT_URL');

  const checks = [
    ['seller backend: GET /api/health answers 200 { status: ok }', async () => {
      const r = await call('GET', seller + '/api/health');
      return r.status === 200 && r.json?.status === 'ok' ? null : 'got ' + r.status;
    }],
    ['seller backend: POST /api/unsubscribe with a bad signature answers 404', async () => {
      const r = await call('POST', seller + '/api/unsubscribe', {
        body: { store: '000000000000000000000000', email: 'smoke@example.test', sig: 'bad-signature' },
      });
      return r.status === 404 ? null : 'got ' + r.status;
    }],
    ['seller backend: the public store route answers (404 for a store that does not exist)', async () => {
      const r = await call('GET', seller + '/api/storefront/v1/stores/by-key/smoke-no-such-store?by=slug');
      return r.status === 404 ? null : 'got ' + r.status;
    }],
    ['seller backend: the outbox flush route refuses without the secret (401)', async () => {
      const r = await call('GET', seller + '/api/internal/notifications/flush');
      return r.status === 401 ? null : 'got ' + r.status;
    }],
    ['admin backend: the outbox flush route refuses without the secret (401)', async () => {
      const r = await call('GET', admin + '/api/internal/notifications/flush');
      return r.status === 401 ? null : 'got ' + r.status;
    }],
    ['admin backend: GET /api/admin/me without a session answers 401', async () => {
      const r = await call('GET', admin + '/api/admin/me');
      return r.status === 401 ? null : 'got ' + r.status;
    }],
    ['storefront: GET /robots.txt answers 200', async () => {
      const res = await fetch(storefront + '/robots.txt', { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
      return res.status === 200 ? null : 'got ' + res.status;
    }],
  ];

  let failed = 0;
  for (const [name, run] of checks) {
    let problem;
    try {
      problem = await run();
    } catch (err) {
      problem = 'request failed (' + (err instanceof Error ? err.name : 'error') + ')';
    }
    if (problem === null) console.log('PASS  ' + name);
    else {
      failed += 1;
      console.log('FAIL  ' + name + ' - ' + problem);
    }
  }
  console.log('\n' + (checks.length - failed) + ' of ' + checks.length + ' passed.');
  process.exit(failed === 0 ? 0 : 1);
}

main();
