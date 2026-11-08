import type { NextRequest } from 'next/server';
import { restoreProduct, type ProductRouteContext } from '@/lib/product-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(request: NextRequest, context: ProductRouteContext): Promise<Response> {
  return restoreProduct(request, context);
}
