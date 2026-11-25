import type { AdminTraffic } from '../../../../../packages/contracts/src/admin-traffic';
import { NO_STORE, requirePolicy } from '@/lib/admin-session';
import { readTraffic } from '@/lib/seller-moderation-client';
import { assertCan } from '@/lib/workspace';

/*
 * Sprint 8 (S8-B7, D-118): the platform's visits and orders per day for the overview card. One signed call to the seller backend, which sums the anonymous
 * counters of the last 14 days: sums only, no store and no person. Capability overview.read, declared by the route file.
 */

export const trafficSteps = { read: readTraffic as (adminId: string) => Promise<AdminTraffic> };

/** GET /api/admin/overview/traffic */
export async function trafficFor(adminId: string): Promise<Response> {
  requirePolicy(() => assertCan('admin', 'read', 'stores'));
  return Response.json(await trafficSteps.read(adminId), { status: 200, headers: NO_STORE });
}
