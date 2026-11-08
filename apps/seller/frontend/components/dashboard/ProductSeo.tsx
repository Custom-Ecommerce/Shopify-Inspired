"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Local copies of PRODUCT_SEO_TITLE_MAX and PRODUCT_SEO_DESCRIPTION_MAX in packages/contracts. The server decides. */
const TITLE_MAX = 70;
const DESCRIPTION_MAX = 160;

export interface SeoValues {
  seoTitle: string;
  seoDescription: string;
  seoImage: string | null;
}

/** The SEO section: what a search result shows, as it is typed. An empty field falls back as the storefront does. */
export function ProductSeo({
  values,
  title,
  description,
  slug,
  images,
  onChange,
}: {
  values: SeoValues;
  title: string;
  description: string;
  slug: string;
  images: ReadonlyArray<{ id: string; url: string }>;
  onChange: (change: Partial<SeoValues>) => void;
}) {
  const shownTitle = values.seoTitle.trim() || title.trim() || "Product title";
  const shownDescription = values.seoDescription.trim() || description.replace(/\s+/g, " ").trim().slice(0, DESCRIPTION_MAX);
  const inGallery = values.seoImage === null || images.some((image) => image.id === values.seoImage);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border p-4">
        <p className="text-xs text-muted-foreground mb-1">Search result preview</p>
        <p className="text-base font-medium text-primary truncate">{shownTitle}</p>
        <p className="text-xs text-muted-foreground truncate">/products/{slug || "your-product"}</p>
        <p className="text-sm mt-1">{shownDescription || "Add a description so search engines have something to show."}</p>
      </div>

      <div>
        <Label htmlFor="seoTitle" className="mb-1">SEO title</Label>
        <Input id="seoTitle" value={values.seoTitle} maxLength={TITLE_MAX} onChange={(e) => onChange({ seoTitle: e.target.value })} />
        <p className="text-xs text-muted-foreground mt-1">{values.seoTitle.length} of {TITLE_MAX} characters. Empty uses the product title.</p>
      </div>

      <div>
        <Label htmlFor="seoDescription" className="mb-1">SEO description</Label>
        <Textarea id="seoDescription" rows={2} value={values.seoDescription} maxLength={DESCRIPTION_MAX} onChange={(e) => onChange({ seoDescription: e.target.value })} />
        <p className="text-xs text-muted-foreground mt-1">{values.seoDescription.length} of {DESCRIPTION_MAX} characters. Plain text. Empty uses the start of the description.</p>
      </div>

      <div>
        <Label htmlFor="seoImage" className="mb-1">SEO image</Label>
        <select
          id="seoImage"
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          value={values.seoImage ?? ""}
          onChange={(e) => onChange({ seoImage: e.target.value === "" ? null : e.target.value })}
        >
          <option value="">First product image</option>
          {images.map((image, index) => (
            <option key={image.id} value={image.id}>Image {index + 1}</option>
          ))}
          {!inGallery && values.seoImage !== null ? <option value={values.seoImage}>Saved image</option> : null}
        </select>
      </div>
    </div>
  );
}
