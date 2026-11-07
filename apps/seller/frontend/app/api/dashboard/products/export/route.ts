import { NextRequest } from "next/server";
import { proxyGet } from "@/lib/proxy";

/** GET /api/dashboard/products/export. The CSV comes from the seller backend as it is. ?template=1 is the empty format. */
export function GET(req: NextRequest) {
  return proxyGet(req, "/api/products/export", {
    auth: "dashboard",
    logScope: "[api/dashboard/products/export]",
  });
}
