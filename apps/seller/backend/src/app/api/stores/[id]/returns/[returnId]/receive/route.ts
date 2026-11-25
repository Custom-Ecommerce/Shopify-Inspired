import type { NextRequest } from 'next/server';
import { handleRouteError } from '@/lib/http';
import { stockRestoreSummary } from '@/lib/order-stock';
import { returnReceiveRequestSchema } from '@/lib/contracts';
import { receiveReturn } from '@/lib/return-actions';
import { json, prepareReturnRoute, sellerReturnView } from '@/lib/return-routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/stores/:id/returns/:returnId/receive { items: [{ productId, variantId, quantity, restock }] } (Sprint 5 EP-13.US02.T03): approved ->
 * received in ONE compare-and-set. Only the winner puts the lines marked restock back on the shelf (never more than was asked for, reason
 * return_restock), so the stock goes back once. When every delivered quantity of the order is back across its returns the order moves
 * delivered -> returned through its own compare-and-set; a partial return leaves it delivered.
 *   200 { return, orderReturned, stockRestore: { restored, skipped, failed }, stockNote }
 *   400 ACCOUNT_BODY_INVALID | RETURN_BODY_INVALID { field }   401   403   404   409 RETURN_STATUS_CHANGED
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string; returnId: string }> }): Promise<Response> {
  try {
    const { route, body } = await prepareReturnRoute(request, await context.params, { schema: returnReceiveRequestSchema, fields: () => ['items'] }, 'returns.write');
    const result = await receiveReturn(route.storeId, route.returnId, route.actor, body);
    return json({
      return: await sellerReturnView(route.storeId, result.doc, result.order),
      orderReturned: result.orderReturned,
      stockRestore: result.stockRestore,
      stockNote: stockRestoreSummary(result.stockRestore),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
