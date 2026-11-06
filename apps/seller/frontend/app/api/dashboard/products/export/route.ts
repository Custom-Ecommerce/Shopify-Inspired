import type { ListEnvelope as PayloadFindResponse } from "@markaz/api-compat";
import type { Product as PayloadProductDoc } from "@markaz/contracts";
import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { proxyGet } from "@/lib/proxy";

const CSV_COLUMNS = [
  "title",
  "slug",
  "price",
  "originalPrice",
  "description",
  "category",
  "stockStatus",
  "stockQuantity",
  "isFeatured",
  "highlights",
] as const;

/** Phase 7.4 — GET /api/dashboard/products/export: mirror image of the import route's column set */
export function GET(req: NextRequest) {
  return proxyGet(req, "/api/products", {
    auth: "dashboard",
    params: (searchParams, auth) => {
      if (auth.storeId) {
        searchParams.set("where", JSON.stringify({ store: { equals: auth.storeId } }));
      }
      searchParams.set("limit", "1000");
      searchParams.set("depth", "1");
    },
    responseHandler: (res, data: PayloadFindResponse<PayloadProductDoc>) => {
      if (!res.ok) {
        return NextResponse.json(data ?? { error: "Could not fetch products." }, { status: res.status });
      }
      const products = data.docs ?? [];
      const rows = products.map((p) => ({
        title: p.title,
        slug: p.slug,
        price: p.price,
        originalPrice: p.originalPrice ?? "",
        description: p.description ?? "",
        category: (typeof p.categories?.[0] === "object" ? p.categories[0]?.name : p.categories?.[0]) ?? "",
        stockStatus: p.stockStatus,
        stockQuantity: p.stockQuantity,
        isFeatured: p.isFeatured ? "true" : "false",
        highlights: (p.highlights ?? []).map((h) => h.text).join("|"),
      }));

      const csv = Papa.unparse({ fields: [...CSV_COLUMNS], data: rows });
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="products.csv"',
        },
      });
    },
    logScope: "[api/dashboard/products/export]",
  });
}

