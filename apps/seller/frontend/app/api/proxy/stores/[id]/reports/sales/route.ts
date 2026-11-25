import { NextRequest } from "next/server";
import { proxyStoreGet } from "@/lib/store-proxy";

/** GET /api/proxy/stores/:id/reports/sales?from&to&status&method (S8-B7): the sales report CSV, with its row headers. The backend checks the role. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyStoreGet(req, id, "reports/sales", "[proxy store sales report]");
}
