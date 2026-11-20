import { NextRequest } from "next/server";
import { proxyStoreGet } from "@/lib/store-proxy";

/** GET /api/proxy/stores/:id/customers/export?q&sort&repeat&hasEmail&unsubscribed&phone: the customers as a CSV file (the backend caps it at 5000 rows). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyStoreGet(req, id, "customers/export", "[proxy store customers export]");
}
