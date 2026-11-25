import type { NextRequest } from 'next/server';
import { handleRouteError } from '@/lib/http';
import { returnRejectRequestSchema } from '@/lib/contracts';
import { rejectReturn } from '@/lib/return-actions';
import { json, prepareReturnRoute, sellerReturnView } from '@/lib/return-routes';
import { returnDecisionText } from '@/lib/returns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/stores/:id/returns/:returnId/reject { reason } (Sprint 5 EP-13.US02.T02): requested -> rejected in ONE compare-and-set. The reason
 * is 5 to 200 characters of plain text; it is stored on the return and told to the shopper, and never copied to the audit entry.
 *   200 { return, decisionText }   400 ACCOUNT_BODY_INVALID { field: reason }   401   403   404   409 RETURN_STATUS_CHANGED
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string; returnId: string }> }): Promise<Response> {
  try {
    const { route, body } = await prepareReturnRoute(request, await context.params, { schema: returnRejectRequestSchema, fields: () => ['reason'] }, 'returns.write');
    const { doc, order } = await rejectReturn(route.storeId, route.returnId, route.actor, body);
    const view = await sellerReturnView(route.storeId, doc, order);
    return json({
      return: view,
      decisionText: returnDecisionText('rejected', { storeName: route.storeName, customerName: view.customerName, returnNumber: view.returnNumber ?? '', orderNumber: view.orderNumber ?? '', reason: body.reason }),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
