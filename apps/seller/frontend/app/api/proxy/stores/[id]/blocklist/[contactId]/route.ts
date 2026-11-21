import { NextRequest } from "next/server";
import { proxyStoreDelete } from "@/lib/store-proxy";

/** DELETE /api/proxy/stores/:id/blocklist/:contactId: takes one contact off the blocklist. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; contactId: string }> }) {
  const { id, contactId } = await params;
  return proxyStoreDelete(req, id, `blocklist/${encodeURIComponent(contactId)}`, "[proxy store blocklist remove]");
}
