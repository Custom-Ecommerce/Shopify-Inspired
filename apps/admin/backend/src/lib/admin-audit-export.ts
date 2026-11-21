import { AdminHttpError } from '@/lib/admin-auth';
import { loadPeople } from '@/lib/admin-people';
import { buildAuditFilter, parseAuditQuery, toAuditListEntry } from '@/lib/admin-audit';
import { CSV_BOM } from '@/lib/commission-report-csv';
import type { Doc } from '@/lib/admin-stores';
import { AuditLog, assertCan, writeAuditLog } from '@/lib/workspace';

/**
 * Sprint 6 EP-20 (S6-B6, D-118): the audit CSV export. Owner level only (audit.export, declared by the route file). The same filters as the audit page
 * (action, search) plus a date range; at most 5000 rows, newest first (a longer result is cut and the answer says so in X-Export-Truncated). UTF-8
 * with a BOM so a spreadsheet reads it right. A cell that starts with = + - @ (or a tab or return) gets a leading apostrophe, the same guard as the
 * customers CSV; a plain E.164 phone number (+ and 7 to 15 digits) is NOT guarded: it is text, never a formula. The EXPORT ITSELF is audited
 * (audit.exported: who, the filters and the row count), BEFORE the file is returned, and fails closed: no entry, no file.
 */

export const AUDIT_EXPORT_ROW_CAP = 5000;
export const AUDIT_EXPORT_HEADER = ['Time (UTC)', 'Action', 'Entity', 'Entity id', 'Actor id', 'Actor name', 'Reason', 'Note', 'From', 'To'] as const;

export const auditExportSteps = {
  audit: writeAuditLog as unknown as (action: string, entity: string, entityId: string, actorId: string, details: Record<string, unknown>) => Promise<unknown>,
};

const FORMULA_START = /^[=+\-@\t\r]/;
const E164 = /^\+[0-9]{7,15}$/;

export function auditCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '""';
  const guarded = FORMULA_START.test(value) && !E164.test(value) ? "'" + value : value;
  return '"' + guarded.replace(/"/g, '""') + '"';
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface AuditExportQuery {
  action: string | null;
  q: string | null;
  from: string | null;
  to: string | null;
}

/** The export's filters: action and q as on the page, from and to as UTC days (to inclusive). 400 names a bad one. */
export function parseExportQuery(params: URLSearchParams): AuditExportQuery {
  const base = parseAuditQuery(params);
  if (!base.ok) {
    const issue = base.issues.find((i) => i.path === 'action' || i.path === 'q');
    if (issue) throw new AdminHttpError(400, issue.message, 'ACCOUNT_BODY_INVALID', issue.path);
  }
  const from = (params.get('from') ?? '').trim();
  const to = (params.get('to') ?? '').trim();
  for (const [name, value] of [['from', from], ['to', to]] as const) {
    if (value !== '' && (!DAY.test(value) || Number.isNaN(Date.parse(value + 'T00:00:00Z')))) throw new AdminHttpError(400, 'Use a date like 2026-11-20.', 'ACCOUNT_BODY_INVALID', name);
  }
  if (from !== '' && to !== '' && from > to) throw new AdminHttpError(400, 'The start date is after the end date.', 'ACCOUNT_BODY_INVALID', 'from');
  const ok = base.ok ? base.query : { action: null, q: null };
  return { action: ok.action, q: ok.q, from: from === '' ? null : from, to: to === '' ? null : to };
}

export function exportFilter(query: AuditExportQuery): Doc {
  const base = buildAuditFilter({ page: 1, limit: 1, q: query.q, action: query.action });
  const range: Doc = {};
  if (query.from) range.$gte = new Date(query.from + 'T00:00:00.000Z');
  if (query.to) range.$lt = new Date(new Date(query.to + 'T00:00:00.000Z').getTime() + 86_400_000);
  if (Object.keys(range).length === 0) return base;
  return Object.keys(base).length === 0 ? { createdAt: range } : { $and: [base, { createdAt: range }] };
}

export function toAuditCsv(entries: ReturnType<typeof toAuditListEntry>[]): string {
  const lines = [AUDIT_EXPORT_HEADER.map(auditCsvCell).join(',')];
  for (const e of entries) {
    lines.push([e.createdAt, e.action, e.entity, e.entityId, e.actor.id, e.actor.name, e.reason, e.note, e.from, e.to].map(auditCsvCell).join(','));
  }
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}

export async function exportAudit(request: Request, adminId: string): Promise<Response> {
  assertCan('admin', 'read', 'audit-log');
  const query = parseExportQuery(new URL(request.url).searchParams);
  const filter = exportFilter(query) as never;
  const [rows, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).limit(AUDIT_EXPORT_ROW_CAP).lean() as unknown as Promise<Doc[]>,
    AuditLog.countDocuments(filter),
  ]);
  const people = await loadPeople(rows.map((row) => (typeof row.actorId === 'string' ? row.actorId : null)));
  const csv = toAuditCsv(rows.map((row) => toAuditListEntry(row, people)));
  try {
    await auditExportSteps.audit('audit.exported', 'audit-log', 'export', adminId, { filters: query, rows: rows.length, truncated: total > rows.length, at: new Date().toISOString() });
  } catch {
    throw new AdminHttpError(503, 'The export could not be made because its audit entry could not be written.');
  }
  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="audit-log.csv"',
      'cache-control': 'no-store',
      'x-export-truncated': total > rows.length ? 'true' : 'false',
    },
  });
}
