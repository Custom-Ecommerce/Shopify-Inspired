import type { NextRequest } from 'next/server';
import { handleRouteError } from '@/lib/http';
import { returnRefundRequestSchema } from '@/lib/contracts';
import { recordRefund } from '@/lib/return-actions';
import { json, prepareReturnRoute, sellerReturnView } from '@/lib/return-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/stores/:id/returns/:returnId/refund { amount, method: bank | jazzcash | easypaisa | cash, reference? } (Sprint 5 EP-13.US03.T01,
 * D-107): RECORDS a refund the seller paid by their own means; no money moves through the system. Only after the return was received, only for
 * a cash on delivery order, between Rs. 1 and what is left of the paid value of the returned quantities (price less discount share, delivery
 * excluded), in parts. ONE compare-and-set on the running total; the return becomes refunded when the cap is reached. The proportional
 * commission reversal is written once per return.
 *   200 { return, cap, completed, commissionReversed }   400 ACCOUNT_BODY_INVALID { field }   401   403   404
 *   409 RETURN_STATUS_CHANGED   422 CARD_REFUND_UNSUPPORTED | REFUND_EXCEEDS_CAP { field: amount }
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string; returnId: string }> }): Promise<Response> {
  try {
    const { route, body } = await prepareReturnRoute(request, await context.params, {
      schema: returnRefundRequestSchema,
      fields: (value) => (value.reference === null ? ['amount', 'method'] : ['amount', 'method', 'reference']),
    });
    const result = await recordRefund(route.storeId, route.returnId, route.actor, body);
    return json({
      return: await sellerReturnView(route.storeId, result.doc),
      cap: result.cap,
      completed: result.completed,
      commissionReversed: result.reversal?.outcome === 'created' ? result.reversal.amount : 0,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
