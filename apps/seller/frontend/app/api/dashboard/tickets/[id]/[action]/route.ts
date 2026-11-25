import { NextRequest, NextResponse } from "next/server";
import { proxyPost } from "@/lib/proxy";

type Context = { params: Promise<{ id: string; action: string }> };

const ACTIONS = ["reply", "close"] as const;

/** POST /api/dashboard/tickets/:id/reply { revision, text } and /close { revision } (Sprint 7, S7-B4). Any other action is a 404. `bindStore` is off (strict body). */
export async function POST(req: NextRequest, context: Context) {
  const { id, action } = await context.params;
  if (!(ACTIONS as readonly string[]).includes(action)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return proxyPost(req, `/api/tickets/${encodeURIComponent(id)}/${action}`, { auth: "dashboard", storeScope: "optional", bindStore: false, logScope: "[api/dashboard/tickets]" });
}
