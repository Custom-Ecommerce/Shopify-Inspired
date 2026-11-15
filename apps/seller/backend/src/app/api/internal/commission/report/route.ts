import type { NextRequest } from 'next/server';
import { buildCommissionReport } from '@/lib/commission-report';
import { commissionReportQuerySchema } from '@/lib/contracts';
import { signedQuery } from '@/lib/internal-query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/internal/commission/report?storeId&period&from&to (signed by the admin backend). The commission earned, the sales,
 * the order count and the balance of one store and period, summed from the ledger.
 */
export function GET(request: NextRequest): Promise<Response> {
  return signedQuery(request, commissionReportQuerySchema, (query) => buildCommissionReport(query));
}
