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
  stockStatus?: string;
  stockQuantity?: string;
  isFeatured?: string;
  highlights?: string;
}

const STOCK_STATUSES = new Set(["in_stock", "low_stock", "out_of_stock"]);

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

    // Slug uniqueness is scoped to "for this seller's store" per spec —
    // in practice `slug` is globally unique on the Products collection
    // (see Products.ts), so this check is really "is this slug taken by
    // ANYONE" — but reported to the seller in terms of their own import,
    // since a cross-store collision is what they'd actually hit.
    try {
      const where = encodeURIComponent(JSON.stringify({ slug: { equals: slug } }));
      const checkRes = await fetch(`${PAYLOAD_API_URL}/api/products?where=${where}&limit=1&depth=0`, {
        cache: "no-store",
      });
      const checkData = await checkRes.json();
      if (checkData?.docs?.length) {
        errors.push({ row: rowNum, reason: `Slug "${slug}" is already taken.` });
        continue;
      }
    } catch {
      errors.push({ row: rowNum, reason: "Could not verify slug uniqueness." });
      continue;
    }

    const stockStatus = STOCK_STATUSES.has(row.stockStatus ?? "") ? row.stockStatus : "in_stock";
    const stockQuantity = row.stockQuantity ? Number(row.stockQuantity) : 0;
    const highlights = row.highlights
      ? row.highlights.split("|").map((text) => ({ text: text.trim() })).filter((h) => h.text)
      : undefined;

    // `categories` (plural, relationship, hasMany, required — see
    // Products.ts) needs an actual Category id, not a free-text name.
    // The CSV's `category` column is treated as a name or slug and
    // resolved here; a 24-hex-char value is assumed to already be an id.
    const categoryValue = row.category?.trim();
    let categoryId: string | undefined;
    if (categoryValue) {
      if (/^[a-f0-9]{24}$/i.test(categoryValue)) {
        categoryId = categoryValue;
      } else {
        try {
          const where = encodeURIComponent(
            JSON.stringify({ or: [{ name: { equals: categoryValue } }, { slug: { equals: categoryValue } }] })
          );
          const catRes = await fetch(`${PAYLOAD_API_URL}/api/categories?where=${where}&limit=1&depth=0`, {
            cache: "no-store",
          });
          const catData = await catRes.json();
          categoryId = catData?.docs?.[0]?.id;
        } catch {
          // fall through — handled by the required-field check below
        }
      }
    }
    if (!categoryId) {
      errors.push({ row: rowNum, reason: categoryValue ? `Category "${categoryValue}" not found.` : "Missing category." });
      continue;
    }

    const data: Record<string, unknown> = {
      title: row.title.trim(),
      slug,
      price,
      originalPrice: row.originalPrice ? Number(row.originalPrice) : undefined,
      description: row.description?.trim() || undefined,
      stockStatus,
      stockQuantity: Number.isNaN(stockQuantity) ? 0 : stockQuantity,
      isFeatured: row.isFeatured?.trim().toLowerCase() === "true",
      highlights,
      categories: [categoryId],
      // Products.media is required (minRows: 1) — a CSV row has no way to
      // supply image files, so a bulk-imported product is created without
      // one and needs at least one added via the dashboard's product edit
      // form afterwards. Noted in the delivery report.
    };
    data.store = storeId; // unconditional (§6.4)

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
        errors.push({ row: rowNum, reason: errData?.errors?.[0]?.message ?? `Import failed (${res.status}).` });
        continue;
      }
      success++;
    } catch {
      errors.push({ row: rowNum, reason: "Could not reach the backend." });
    }
  }

  return NextResponse.json({ success, errors });
}
