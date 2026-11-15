import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { HttpError } from '@/lib/http';
import { readSignedRequest } from '@/lib/internal-signature';
import { connectSellerDb } from '@/lib/mongo';
import { handleProductError } from '@/lib/products';

const NO_STORE = { 'Cache-Control': 'no-store' };

interface QuerySchema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
}

/**
 * The route of one signed GET read of the admin backend (the read twin of moderationAction in moderation.ts): the signature
 * first, then the query, and only then the database. A seller session means nothing here; only MODERATION_API_SECRET does.
 * The signature covers the path and the query string, so a query cannot be swapped on the way.
 */
export async function signedQuery<T, R>(request: NextRequest, schema: QuerySchema<T>, run: (query: T, adminId: string) => Promise<R>): Promise<Response> {
  try {
    const signed = await readSignedRequest(request);
    if (!signed.ok) return signed.response;

    const parsed = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      const errors = parsed.error.issues.map((issue) => ({ message: issue.message, code: 'INVALID_REQUEST', path: issue.path.map(String).join('.') }));
      return NextResponse.json({ errors }, { status: 422, headers: NO_STORE });
    }
    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });
    return NextResponse.json(await run(parsed.data, signed.adminId), { headers: NO_STORE });
  } catch (err) {
    return handleProductError(err);
  }
}
