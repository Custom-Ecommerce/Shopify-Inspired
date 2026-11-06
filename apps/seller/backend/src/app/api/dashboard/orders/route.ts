export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Placeholder for the dashboard/orders collection (YELLOW fix). Replace in the data-plane milestone. */
export async function GET(): Promise<Response> {
  return Response.json({ data: [], placeholder: true, resource: 'dashboard/orders' }, { status: 200 });
}
