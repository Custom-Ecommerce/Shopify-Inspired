import { NextResponse } from 'next/server';
import type { ZodType } from 'zod';

export type BodyResult<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

/** Parses the JSON body against a contract. A malformed body is a 400; a contract violation is a 422. */
export async function parseBody<T>(request: Request, schema: ZodType<T, unknown>): Promise<BodyResult<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Body must be JSON' }, { status: 400 }) };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Invalid request',
          issues: result.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message })),
        },
        { status: 422 },
      ),
    };
  }
  return { ok: true, data: result.data };
}

/** Scaffold response for a valid request whose implementation lands in a later milestone. */
export function notImplemented(milestone: string): NextResponse {
  return NextResponse.json({ error: 'Not implemented yet', milestone }, { status: 501 });
}

/** Rejects a path id that is not an ObjectId, before the body is read. */
export function invalidStoreId(): NextResponse {
  return NextResponse.json(
    { error: 'Invalid request', issues: [{ path: 'id', message: 'must be a 24-character ObjectId' }] },
    { status: 422 },
  );
}
