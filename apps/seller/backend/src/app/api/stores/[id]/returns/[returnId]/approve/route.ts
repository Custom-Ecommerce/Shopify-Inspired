import type { NextRequest } from 'next/server';
import { handleRouteError } from '@/lib/http';
import { approveReturn } from '@/lib/return-actions';
import { json, prepareReturnRouteNoBody, sellerReturnView } from '@/lib/return-routes';
import { returnDecisionText } from '@/lib/returns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/stores/:id/returns/:returnId/approve (Sprint 5 EP-13.US02.T02, D-107): requested -> approved in ONE compare-and-set. The shopper is told
 * by email when the order has an email; the answer also carries the decision text (English and Urdu) for the wa.me link the seller sends
 * from their own phone, because most shoppers have no email. Foreign store 403, foreign return 404. No body.
 *   200 { return, decisionText }   401   403   404   409 RETURN_STATUS_CHANGED (already decided, or a parallel request won)
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string; returnId: string }> }): Promise<Response> {
  try {
    const route = await prepareReturnRouteNoBody(request, await context.params);
    const { doc, order } = await approveReturn(route.storeId, route.returnId, route.actor);
    const view = await sellerReturnView(route.storeId, doc, order);
    return json({
      return: view,
      decisionText: returnDecisionText('approved', { storeName: route.storeName, customerName: view.customerName, returnNumber: view.returnNumber ?? '', orderNumber: view.orderNumber ?? '' }),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
