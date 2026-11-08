import { NextRequest } from "next/server";
import { proxyPost } from "@/lib/proxy";

/** POST /api/dashboard/inventory/adjust. `bindStore` is off: the contract refuses a store in the body. */
export async function POST(req: NextRequest) {
  return proxyPost(req, "/api/inventory/adjust", {
    auth: "dashboard",
    bindStore: false,
    logScope: "[api/dashboard/inventory/adjust]",
  });
}
