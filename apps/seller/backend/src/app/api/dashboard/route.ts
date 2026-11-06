
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Placeholder for the dashboard data plane (B9 prerequisite). Replace in the data-plane milestone. */
export async function GET(): Promise<Response> {
  return Response.json({ data: [], placeholder: true, resource: 'dashboard' }, { status: 200 });
}
