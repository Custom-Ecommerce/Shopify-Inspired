import { NextRequest } from "next/server";
import { proxyStoreDelete, proxyStorePatchBody } from "@/lib/store-proxy";

/** PATCH /api/proxy/stores/:id/abandoned-carts/:cartId { status: "contacted" }: the seller messaged this shopper. The backend validates the body. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; cartId: string }> }) {
  const { id, cartId } = await params;
  return proxyStorePatchBody(req, id, `abandoned-carts/${encodeURIComponent(cartId)}`, "[proxy store abandoned cart contacted]");
}

/** DELETE /api/proxy/stores/:id/abandoned-carts/:cartId: clears one cart. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; cartId: string }> }) {
  const { id, cartId } = await params;
  return proxyStoreDelete(req, id, `abandoned-carts/${encodeURIComponent(cartId)}`, "[proxy store abandoned cart delete]");
}
