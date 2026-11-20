import { NextRequest } from "next/server";
import { proxyStoreGet } from "@/lib/store-proxy";

/** GET /api/proxy/stores/:id/settings: the saved settings, in the shape of contracts storeSettingsSchema. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyStoreGet(req, id, "settings", "[proxy store settings]");
}
