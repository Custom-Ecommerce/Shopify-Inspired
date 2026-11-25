import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { trafficFor, trafficSteps } from '../src/lib/admin-traffic';

// Sprint 8 (S8-B7, D-118): the overview's traffic card. The signed call is stubbed; the level gate is in test/admin-levels.test.ts.

const saved = { ...trafficSteps };
afterEach(() => Object.assign(trafficSteps, saved));

test('the answer is passed on as it is, never cached', async () => {
  const asked: string[] = [];
  trafficSteps.read = async (adminId) => {
    asked.push(adminId);
    return { days: [{ day: '2026-11-25', visits: 7, orders: 1 }] };
  };
  const res = await trafficFor('admin1');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { days: [{ day: '2026-11-25', visits: 7, orders: 1 }] });
  assert.deepEqual(asked, ['admin1']);
});

test('the route is read only and needs overview.read', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'app', 'api', 'admin', 'overview', 'traffic', 'route.ts'), 'utf8');
  assert.match(source, /authorizeAdmin\(request, 'overview\.read'\)/);
  assert.doesNotMatch(source, /export (async )?function (POST|PUT|PATCH|DELETE)/);
});
