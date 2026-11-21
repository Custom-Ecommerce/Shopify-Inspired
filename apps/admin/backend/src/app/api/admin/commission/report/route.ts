import { errorResponse } from '@/lib/admin-auth';
import { commissionReportFor, readAdminQuery } from '@/lib/admin-payouts';
import { buildCommissionReportCsv, commissionReportFileName } from '@/lib/commission-report-csv';
import { authorizeAdmin, NO_STORE, requirePolicy } from '@/lib/admin-session';
import { commissionReportQuerySchema } from '@/lib/payout-contracts';
import { assertCan } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/commission/report?storeId&period=today|7|30|90|custom&from&to[&format=csv] (Sprint 4 EP-05.US06, D-090): the
 * commission earned, the sales, the order count and the balance of one store and period, summed from the ledger by the seller
 * backend (Asia/Karachi days). format=csv answers the same numbers as a download: UTF-8 with a byte order mark, text cells
 * quoted, and a text cell that starts with = + - or @ prefixed with an apostrophe.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, 'commission.read');
    requirePolicy(() => assertCan('admin', 'read', 'commissionReport'));
    const query = readAdminQuery(request, commissionReportQuerySchema, ['format']);
    const report = await commissionReportFor(userId, query);
    if (new URL(request.url).searchParams.get('format') === 'csv') {
      return new Response(buildCommissionReportCsv([report]), {
        status: 200,
        headers: {
          ...NO_STORE,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="' + commissionReportFileName(report) + '"',
        },
      });
    }
    return Response.json({ report }, { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err);
  }
}
