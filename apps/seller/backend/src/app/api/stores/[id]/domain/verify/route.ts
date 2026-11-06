import { domainVerifyRequestSchema, objectIdSchema } from '@/lib/contracts';
import { invalidStoreId, notImplemented, parseBody } from '@/lib/placeholder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/stores/:id/domain/verify. Returns 501 until B9.5. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  if (!objectIdSchema.safeParse(id).success) return invalidStoreId();
  const body = await parseBody(request, domainVerifyRequestSchema);
  if (!body.ok) return body.response;
  return notImplemented('B9.5 domain verify');
}
