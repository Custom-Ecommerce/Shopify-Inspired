import { runRetention } from '@/lib/seller-moderation-client';

/** Injectable step of the retention route (Next allows only route exports in a route file, so it lives here). Tests replace `run`. */
export const retentionSteps = { run: runRetention };
