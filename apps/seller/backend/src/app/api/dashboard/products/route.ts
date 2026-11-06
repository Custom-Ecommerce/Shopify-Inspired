export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Placeholder for the dashboard/products collection (YELLOW fix). Replace in the data-plane milestone. */
export async function GET(): Promise<Response> {
  return Response.json({ data: [], placeholder: true, resource: 'dashboard/products' }, { status: 200 });
}
