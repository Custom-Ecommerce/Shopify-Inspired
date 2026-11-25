import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as contractsNs from '@markaz/contracts';
import { unwrapCjs } from '@/lib/cjs';
import { DailyStat } from '@/lib/services';
import { buildAdminTraffic, trafficDays } from '../src/lib/admin-traffic';
import { runPipeline } from './helpers/aggregate';

// Sprint 8 (S8-B7, D-118): the platform's visits and orders per day, one bounded aggregation. The model is stubbed.

const { adminTrafficSchema, ADMIN_TRAFFIC_DAYS } = unwrapCjs(contractsNs) as typeof contractsNs;
const NOW = new Date('2026-11-25T01:00:00.000Z');

test('the last 14 UTC days, summed over every store, zero where there is nothing, in one aggregation bounded by the days', async () => {
  const rows = [
    { store: 's1', day: '2026-11-25', visits: 3, orders: 1 },
    { store: 's2', day: '2026-11-25', visits: 4 },
    { store: 's1', day: '2026-11-12', visits: 7, orders: 2 },
    { store: 's1', day: '2026-11-11', visits: 100, orders: 100 },
  ];
  const model = DailyStat as any;
  const saved = model.aggregate;
  const pipelines: any[][] = [];
  model.aggregate = async (pipeline: any[]) => (pipelines.push(pipeline), runPipeline(rows, pipeline));
  try {
    const out = await buildAdminTraffic(NOW);
    assert.equal(adminTrafficSchema.safeParse(out).success, true);
    assert.equal(out.days.length, ADMIN_TRAFFIC_DAYS);
    assert.deepEqual([out.days[0], out.days.at(-1)], [{ day: '2026-11-12', visits: 7, orders: 2 }, { day: '2026-11-25', visits: 7, orders: 1 }]);
    assert.equal(out.days.reduce((sum, d) => sum + d.visits, 0), 14);
    assert.equal(pipelines.length, 1);
    assert.deepEqual(pipelines[0]![0], { $match: { day: { $gte: '2026-11-12', $lte: '2026-11-25' } } });
    assert.doesNotMatch(JSON.stringify(out), /s1|s2|store/);
  } finally {
    model.aggregate = saved;
  }
});

test('fourteen days, oldest first', () => {
  const days = trafficDays(NOW);
  assert.deepEqual([days.length, days[0], days[13]], [14, '2026-11-12', '2026-11-25']);
});
