export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Placeholder for one products document (YELLOW fix). Replace in the data-plane milestone. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return Response.json({ data: null, placeholder: true, resource: 'products', id }, { status: 200 });
}
