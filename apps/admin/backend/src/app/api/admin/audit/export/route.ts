import { errorResponse } from '@/lib/admin-auth';
import { exportAudit } from '@/lib/admin-audit-export';
import { authorizeAdmin } from '@/lib/admin-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/audit/export?action&q&from&to (Sprint 6 S6-B6). Owner level only (audit.export). CSV, UTF-8 with a BOM, at most 5000 rows, cells that
 * start with = + - @ guarded. The export is itself audited (audit.exported) before the file is returned; 503 when that entry cannot be written.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await authorizeAdmin(request, 'audit.export');
    return await exportAudit(request, userId);
  } catch (err) {
    return errorResponse(err);
  }
}
