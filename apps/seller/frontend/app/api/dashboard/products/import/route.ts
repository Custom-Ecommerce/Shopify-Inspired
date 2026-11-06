import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { apiError, resolveDashboardAuth, PAYLOAD_API_URL } from "@/lib/proxy";

interface CsvRow {
  title?: string;
  slug?: string;
  price?: string;
  originalPrice?: string;
  description?: string;
  category?: string;
  stockQuantity?: string;
  isFeatured?: string;
  highlights?: string;
}

interface StoreCategory {
  id: string;
  name: string;
  slug: string;
}

/** The categories of the verified store, read once per import. Bulk import is rebuilt with its own batch. */
async function loadStoreCategories(token: string, storeId: string): Promise<StoreCategory[]> {
  const res = await fetch(`${PAYLOAD_API_URL}/api/categories?limit=200`, {
    headers: { Authorization: `JWT ${token}`, "x-store-id": storeId },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data: { docs?: StoreCategory[] } = await res.json();
  return data.docs ?? [];
}

function slugify(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Phase 7.4 — POST /api/dashboard/products/import
 */
export async function POST(req: NextRequest) {
  const { auth, errorResponse } = await resolveDashboardAuth(req, "dashboard");
  if (errorResponse) return errorResponse;

  // `resolveDashboardAuth` already verified the store (x-store-id ∈ user.stores).
  const { token, storeId } = auth;
  if (!token || !storeId) {
    return apiError(400, "STORE_CONTEXT_REQUIRED", "No active store was specified for this request.");
  }

  let csvText: string;
  try {
    const body = await req.json();
    csvText = body.csv;
    if (typeof csvText !== "string") throw new Error();
  } catch {
    return apiError(400, "INVALID_BODY", "Expected JSON body with a `csv` string field.");
  }

  const parsed = Papa.parse<CsvRow>(csvText, { header: true, skipEmptyLines: true });
  const rows = parsed.data;

  const categories = await loadStoreCategories(token, storeId).catch((): StoreCategory[] => []);

  let success = 0;
  const errors: { row: number; reason: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // +1 for 1-indexing, +1 for the header row

    if (!row.title?.trim()) {
      errors.push({ row: rowNum, reason: "Missing title." });
      continue;
    }
    const price = Number(row.price);
    if (!row.price || Number.isNaN(price) || price < 0) {
      errors.push({ row: rowNum, reason: "Missing or invalid price." });
      continue;
    }

    const slug = slugify(row.slug?.trim() || row.title);
    if (!slug) {
      errors.push({ row: rowNum, reason: "Could not derive a valid slug." });
      continue;
    }

    const stockQuantity = row.stockQuantity ? Number(row.stockQuantity) : 0;
    const highlights = row.highlights
      ? row.highlights.split("|").map((text) => text.trim()).filter(Boolean)
      : undefined;

    // The CSV's `category` column is a name, a slug or an id of a category of this store.
    const categoryValue = row.category?.trim();
    const wanted = categoryValue?.toLowerCase();
    const categoryId = categories.find(
      (c) => c.id === categoryValue || c.name.toLowerCase() === wanted || c.slug === wanted
    )?.id;
    if (!categoryId) {
      errors.push({ row: rowNum, reason: categoryValue ? `Category "${categoryValue}" not found.` : "Missing category." });
      continue;
    }

    // A taken slug comes back as a refusal for this row. A CSV row has no images: add them in the product form.
    const data: Record<string, unknown> = {
      title: row.title.trim(),
      slug,
      price,
      compareAtPrice: row.originalPrice ? Number(row.originalPrice) : undefined,
      description: row.description?.trim() || undefined,
      stockQuantity: Number.isInteger(stockQuantity) && stockQuantity >= 0 ? stockQuantity : 0,
      isFeatured: row.isFeatured?.trim().toLowerCase() === "true",
      highlights,
      categories: [categoryId],
    };

    try {
      const res = await fetch(`${PAYLOAD_API_URL}/api/products`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `JWT ${token}`,
          "x-store-id": storeId,
        },
        body: JSON.stringify(data),
        cache: "no-store",
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        const reason = errData?.errors?.[0]?.message ?? errData?.issues?.[0]?.message;
        errors.push({ row: rowNum, reason: reason ?? `Import failed (${res.status}).` });
        continue;
      }
      success++;
    } catch {
      errors.push({ row: rowNum, reason: "Could not reach the backend." });
    }
  }

  return NextResponse.json({ success, errors });
}
