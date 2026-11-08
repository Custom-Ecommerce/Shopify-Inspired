import { NextResponse } from "next/server";

/**
 * Retired (EP-02 OB-5b). This pointed at a PDF endpoint that never existed on the seller backend. Labels and packing slips
 * now come from GET /api/dashboard/orders/print?ids=... and the page at /s/[storeId]/orders/print.
 */
export function GET() {
  return NextResponse.json({ error: "This address is no longer in use.", code: "GONE" }, { status: 410 });
}
