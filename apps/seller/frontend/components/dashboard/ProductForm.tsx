"use client";

import type { Category as CategoryDoc, SellerProductDetail } from "@markaz/contracts";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { useStoreHref } from "@/lib/dashboard-context";
import { discountPercent } from "@/lib/product-pricing";
import { refusalMessage, runProductAction } from "@/lib/product-actions";
import { buildMatrix, rowProblem, usableOptions, variantPayload } from "@/lib/variant-matrix";
import type { MatrixRow, OptionDraft, RowValues } from "@/lib/variant-matrix";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Surface } from "@/components/shared/Surface";
import { StatusBadge } from "@/components/dashboard/shared/StatusBadge";
import { VariantBuilder } from "@/components/dashboard/VariantBuilder";

const MAX_IMAGES = 10;
const MAX_HIGHLIGHTS = 10;

function slugify(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

interface ImageEntry {
  id: string;
  url: string;
}

interface FormState {
  title: string;
  slug: string;
  description: string;
  highlights: string;
  categoryIds: string[];
  price: string;
  compareAtPrice: string;
  sku: string;
  barcode: string;
  trackQuantity: boolean;
  stockQuantity: string;
  deliveryCharge: string;
  isFeatured: boolean;
  hideWhenOutOfStock: boolean;
  images: ImageEntry[];
}

function initialState(product?: SellerProductDetail): FormState {
  const variant = product?.variants[0];
  return {
    title: product?.title ?? "",
    slug: product?.slug ?? "",
    description: product?.description ?? "",
    highlights: (product?.highlights ?? []).join("\n"),
    categoryIds: (product?.categories ?? []).map((category) => category.id),
    price: variant ? String(variant.price) : "",
    compareAtPrice: variant?.compareAtPrice != null ? String(variant.compareAtPrice) : "",
    sku: variant?.sku ?? "",
    barcode: variant?.barcode ?? "",
    trackQuantity: variant?.trackQuantity ?? true,
    stockQuantity: variant ? String(variant.stockQuantity) : "0",
    deliveryCharge: product?.deliveryCharge != null ? String(product.deliveryCharge) : "",
    isFeatured: product?.isFeatured ?? false,
    hideWhenOutOfStock: product?.hideWhenOutOfStock ?? false,
    images: (product?.media ?? []).map((media) => ({ id: media.id, url: media.url })),
  };
}

const optionalNumber = (value: string): number | null => (value.trim() === "" ? null : Number(value));
const optionalText = (value: string): string | null => (value.trim() === "" ? null : value.trim());

/** The Default variant's fields as the form holds them, in the shape the API takes. */
function defaultVariantFields(form: FormState) {
  return {
    price: Number(form.price),
    compareAtPrice: optionalNumber(form.compareAtPrice),
    sku: optionalText(form.sku),
    barcode: optionalText(form.barcode),
    trackQuantity: form.trackQuantity,
  };
}

/**
 * The update for the Default variant, or null when the seller changed none of it. Stock is never part of it (D-034). An
 * image taken out of the gallery is also taken off the variant, because the server refuses a link to anything else.
 */
function changedVariant(product: SellerProductDetail, form: FormState) {
  const variant = product.variants[0];
  const fields = defaultVariantFields(form);
  const lostImage = variant.imageId !== null && !form.images.some((image) => image.id === variant.imageId);
  const unchanged =
    !lostImage &&
    fields.price === variant.price &&
    fields.compareAtPrice === variant.compareAtPrice &&
    fields.sku === variant.sku &&
    fields.barcode === variant.barcode &&
    fields.trackQuantity === variant.trackQuantity;
  return unchanged ? null : { id: variant.id, ...fields, ...(lostImage ? { imageId: null } : {}) };
}

function savedDrafts(product?: SellerProductDetail): OptionDraft[] {
  return (product?.options ?? []).map((option, index) => ({ key: `saved-${index}`, name: option.name, values: [...option.values], source: index }));
}

export function ProductForm({ product }: { product?: SellerProductDetail }) {
  const storeFetch = useStoreFetch();
  const href = useStoreHref();
  const router = useRouter();
  const isEdit = Boolean(product);

  const [form, setForm] = useState<FormState>(() => initialState(product));
  const [drafts, setDrafts] = useState<OptionDraft[]>(() => savedDrafts(product));
  const [rowEdits, setRowEdits] = useState<Record<string, Partial<RowValues>>>({});
  const [confirmedRemoval, setConfirmedRemoval] = useState("");
  const [slugEdited, setSlugEdited] = useState(isEdit);
  const [categories, setCategories] = useState<CategoryDoc[]>([]);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [published, setPublished] = useState(product?.status === "published");
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    storeFetch("/api/proxy/categories?limit=200")
      .then((res) => res.json())
      .then((data) => {
        setCategories(data?.docs ?? []);
        // A failed request has no docs, and must not tell the seller that the store has no categories.
        setCategoriesLoaded(Array.isArray(data?.docs));
      });
  }, [storeFetch]);

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const remaining = MAX_IMAGES - form.images.length;
    if (remaining <= 0) {
      toast.error(`Maximum ${MAX_IMAGES} images per product.`);
      return;
    }
    setUploading(true);
    try {
      for (const file of files.slice(0, remaining)) {
        const body = new FormData();
        body.set("file", file);
        body.set("alt", form.title || "Product image");
        const res = await storeFetch("/api/proxy/media", { method: "POST", body });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data?.error ?? "Image upload failed.");
          continue;
        }
        const doc = data.doc ?? data;
        setForm((f) => ({ ...f, images: [...f.images, { id: doc.id, url: doc.url ?? "" }] }));
      }
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  function removeImage(id: string) {
    setForm((f) => ({ ...f, images: f.images.filter((img) => img.id !== id) }));
  }

  /** The gallery order is the shoppers' order: the first image is the primary one. */
  function moveImage(index: number, target: number) {
    setForm((f) => {
      const images = [...f.images];
      const [image] = images.splice(index, 1);
      images.splice(target, 0, image);
      return { ...f, images };
    });
  }

  /** Publishing acts on what is saved, so the page says so rather than guessing at unsaved edits. */
  async function togglePublished() {
    if (!product) return;
    setPublishing(true);
    const refusal = await runProductAction(storeFetch, product.id, published ? "unpublish" : "publish");
    setPublishing(false);
    if (refusal !== null) {
      toast.error(refusal);
      return;
    }
    setPublished(!published);
    toast.success(published ? "Unpublished." : "Published.");
    router.refresh();
  }

  function toggleCategory(id: string, checked: boolean) {
    setForm((f) => ({
      ...f,
      categoryIds: checked ? [...f.categoryIds, id] : f.categoryIds.filter((categoryId) => categoryId !== id),
    }));
  }

  const matrix = useMemo(() => buildMatrix(drafts, product?.variants ?? []), [drafts, product]);
  /** With options the variants table takes over from the single price and stock fields. */
  const hasOptions = usableOptions(drafts).length > 0;
  const removalKey = matrix.removed.map((variant) => variant.id).join(",");
  const removalConfirmed = removalKey === "" || removalKey === confirmedRemoval;

  /** A row's values: what the seller typed, over what is saved. A new row starts from the product's own price. */
  function rowValues(row: MatrixRow): RowValues {
    const variant = product?.variants.find((candidate) => candidate.id === row.id);
    // The Default variant is being given options: what the seller typed in the single fields carries over.
    const fromForm = !variant || (product?.options.length ?? 0) === 0;
    const base: RowValues = {
      price: fromForm ? form.price : String(variant.price),
      compareAt: !variant ? "" : fromForm ? form.compareAtPrice : variant.compareAtPrice === null ? "" : String(variant.compareAtPrice),
      sku: !variant ? "" : fromForm ? form.sku : (variant.sku ?? ""),
      barcode: !variant ? "" : fromForm ? form.barcode : (variant.barcode ?? ""),
      imageId: variant?.imageId ?? null,
      trackQuantity: fromForm ? form.trackQuantity : variant.trackQuantity,
      lowStock: variant?.lowStockThreshold != null ? String(variant.lowStockThreshold) : "",
      stock: "0",
    };
    return { ...base, ...rowEdits[row.key] };
  }

  function changeRows(keys: readonly string[], change: Partial<RowValues>) {
    setRowEdits((edits) => ({ ...edits, ...Object.fromEntries(keys.map((key) => [key, { ...edits[key], ...change }])) }));
  }

  const highlights = form.highlights.split("\n").map((line) => line.trim()).filter(Boolean);
  const price = Number(form.price);
  const compareAt = optionalNumber(form.compareAtPrice);
  const percentOff = discountPercent(Math.round(price), compareAt === null ? null : Math.round(compareAt));

  const priceError = !hasOptions && form.price !== "" && price < 0 ? "Price cannot be negative." : null;
  const compareAtError =
    !hasOptions && compareAt !== null && form.price !== "" && compareAt <= price
      ? "The compare-at price must be higher than the price."
      : null;
  const highlightsError = highlights.length > MAX_HIGHLIGHTS ? `At most ${MAX_HIGHLIGHTS} highlights.` : null;
  const variantProblem = (() => {
    if (drafts.some((draft) => draft.name.trim() === "" || draft.values.length === 0)) return "Give every option a name and at least one value.";
    const names = drafts.map((draft) => draft.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) return "Two options have the same name.";
    if (matrix.tooMany) return "This product has too many variants.";
    if (!removalConfirmed) return "Confirm the variants that will be removed.";
    if (hasOptions && matrix.rows.some((row) => rowProblem(rowValues(row), row.id === null) !== null)) return "Fix the variants marked in the table.";
    return null;
  })();
  const isInvalid =
    !form.title.trim() ||
    form.categoryIds.length === 0 ||
    (!hasOptions && form.price === "") ||
    !!priceError ||
    !!compareAtError ||
    !!highlightsError ||
    variantProblem !== null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isInvalid) {
      toast.error(variantProblem ?? "Title, price, and at least one category are required.");
      return;
    }

    const shared = {
      title: form.title.trim(),
      description: form.description.trim() === "" ? null : form.description.trim(),
      highlights,
      categories: form.categoryIds,
      media: form.images.map((img) => img.id),
      deliveryCharge: optionalNumber(form.deliveryCharge),
      isFeatured: form.isFeatured,
      hideWhenOutOfStock: form.hideWhenOutOfStock,
    };

    const gallery = new Set(form.images.map((img) => img.id));
    // Options and the whole list go together (D-036): a saved variant left out of the list is removed.
    const variantData = {
      options: usableOptions(drafts).map((option) => ({ name: option.name.trim(), values: option.values })),
      variants: matrix.rows.map((row) => variantPayload(row, rowValues(row), gallery)),
    };

    let data: Record<string, unknown>;
    if (product && hasOptions) {
      data = { ...shared, slug: form.slug, ...variantData };
    } else if (product && product.options.length > 0) {
      // The last option was taken away: one variant stays, as the Default variant.
      const kept = changedVariant(product, form) ?? { id: product.variants[0].id };
      data = { ...shared, slug: form.slug, options: [], variants: [{ ...kept, optionValues: [] }] };
    } else if (product) {
      const variant = changedVariant(product, form);
      data = { ...shared, slug: form.slug, ...(variant ? { variants: [variant] } : {}) };
    } else if (hasOptions) {
      data = { ...shared, ...(form.slug ? { slug: form.slug } : {}), ...variantData };
    } else {
      data = {
        ...shared,
        ...(form.slug ? { slug: form.slug } : {}),
        ...defaultVariantFields(form),
        stockQuantity: Number(form.stockQuantity) || 0,
      };
    }

    setSaving(true);
    try {
      const url = product ? `/api/dashboard/products/${product.id}` : "/api/dashboard/products";
      const res = await storeFetch(url, {
        method: product ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const resData = await res.json();
      if (!res.ok) {
        toast.error(refusalMessage(resData));
        return;
      }
      router.push(href("/products"));
      router.refresh();
    } catch {
      toast.error("Could not reach the backend. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6 max-w-3xl">
      <Surface variant="clay" level={2} className="p-6 flex flex-col gap-5 rounded-2xl">
        <h2 className="font-heading text-lg font-semibold">Basic Details</h2>
        <div>
          <Label htmlFor="title" className="mb-1">Title*</Label>
          <Input
            id="title"
            value={form.title}
            onChange={(e) => {
              const title = e.target.value;
              setForm((f) => ({ ...f, title, slug: slugEdited ? f.slug : slugify(title) }));
            }}
            required
          />
        </div>

        <div>
          <Label htmlFor="slug" className="mb-1">Slug</Label>
          <Input
            id="slug"
            value={form.slug}
            onChange={(e) => {
              setSlugEdited(true);
              setForm((f) => ({ ...f, slug: slugify(e.target.value) }));
            }}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground mt-1">
            {isEdit ? "Changing the title does not change the slug." : "Made from the title. You can edit it."}
          </p>
        </div>

        <div>
          <Label htmlFor="description" className="mb-1">Description</Label>
          <Textarea
            id="description"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            maxLength={5000}
            rows={5}
          />
          <p className="text-xs text-muted-foreground mt-1">Plain text only. Line breaks are kept.</p>
        </div>

        <div>
          <Label htmlFor="highlights" className="mb-1">Highlights</Label>
          <Textarea
            id="highlights"
            value={form.highlights}
            onChange={(e) => setForm((f) => ({ ...f, highlights: e.target.value }))}
            rows={3}
          />
          <p className="text-xs text-muted-foreground mt-1">One per line, up to {MAX_HIGHLIGHTS}.</p>
          {highlightsError && <p className="text-xs text-destructive mt-1">{highlightsError}</p>}
        </div>

        <div>
          <Label className="mb-1">Categories*</Label>
          <div className="flex flex-col gap-2 mt-1">
            {categories.map((category) => (
              <div key={category.id} className="flex items-center gap-2">
                <Checkbox
                  id={`category-${category.id}`}
                  checked={form.categoryIds.includes(category.id)}
                  onCheckedChange={(checked) => toggleCategory(category.id, checked === true)}
                />
                <Label htmlFor={`category-${category.id}`}>{category.name}</Label>
              </div>
            ))}
          </div>
          {categoriesLoaded && categories.length === 0 ? (
            <Link href={href("/categories")} className="mt-1 inline-block text-xs font-medium underline underline-offset-4">
              Create a category first
            </Link>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="isFeatured"
            checked={form.isFeatured}
            onCheckedChange={(checked) => setForm((f) => ({ ...f, isFeatured: checked === true }))}
          />
          <Label htmlFor="isFeatured">Feature this product on homepage</Label>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="hideWhenOutOfStock"
            checked={form.hideWhenOutOfStock}
            onCheckedChange={(checked) => setForm((f) => ({ ...f, hideWhenOutOfStock: checked === true }))}
          />
          <Label htmlFor="hideWhenOutOfStock">Hide from the store while out of stock</Label>
        </div>
      </Surface>

      <Surface variant="clay" level={2} className="p-6 flex flex-col gap-5 rounded-2xl">
        <h2 className="font-heading text-lg font-semibold">{hasOptions ? "Variants" : "Price & Stock"}</h2>

        <VariantBuilder
          drafts={drafts}
          onDraftsChange={setDrafts}
          matrix={matrix}
          valuesOf={rowValues}
          onRowsChange={changeRows}
          images={form.images}
          stockOf={(id) => product?.variants.find((variant) => variant.id === id) ?? null}
          inventoryHref={href("/inventory")}
          removalConfirmed={removalConfirmed}
          onRemovalConfirmed={(confirmed) => setConfirmedRemoval(confirmed ? removalKey : "")}
        />

        {hasOptions ? null : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="price" className="mb-1">Price (PKR)*</Label>
                <Input
                  id="price"
                  type="number"
                  min={0}
                  step={1}
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                  required
                />
                {priceError && <p className="text-xs text-destructive mt-1">{priceError}</p>}
              </div>
              <div>
                <Label htmlFor="compareAtPrice" className="mb-1">Compare-at price (PKR)</Label>
                <Input
                  id="compareAtPrice"
                  type="number"
                  min={0}
                  step={1}
                  value={form.compareAtPrice}
                  onChange={(e) => setForm((f) => ({ ...f, compareAtPrice: e.target.value }))}
                />
                {compareAtError && <p className="text-xs text-destructive mt-1">{compareAtError}</p>}
                {percentOff > 0 && <p className="text-xs text-muted-foreground mt-1">Shoppers see {percentOff}% off.</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="sku" className="mb-1">SKU</Label>
                <Input id="sku" value={form.sku} onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))} maxLength={64} />
              </div>
              <div>
                <Label htmlFor="barcode" className="mb-1">Barcode</Label>
                <Input id="barcode" value={form.barcode} onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))} maxLength={64} />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="trackQuantity"
                checked={form.trackQuantity}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, trackQuantity: checked === true }))}
              />
              <Label htmlFor="trackQuantity">Track quantity</Label>
            </div>

            <div>
              <Label htmlFor="stockQuantity" className="mb-1">{isEdit ? "Stock" : "Initial stock"}</Label>
              <Input
                id="stockQuantity"
                type="number"
                min={0}
                step={1}
                value={form.stockQuantity}
                onChange={(e) => setForm((f) => ({ ...f, stockQuantity: e.target.value }))}
                readOnly={isEdit}
                disabled={isEdit}
              />
              {isEdit && <p className="text-xs text-muted-foreground mt-1">Adjust stock in Inventory.</p>}
            </div>
          </>
        )}

        <div>
          <Label htmlFor="deliveryCharge" className="mb-1">Delivery charge override (PKR)</Label>
          <Input
            id="deliveryCharge"
            type="number"
            min={0}
            step={1}
            value={form.deliveryCharge}
            onChange={(e) => setForm((f) => ({ ...f, deliveryCharge: e.target.value }))}
          />
          <p className="text-xs text-muted-foreground mt-1">Leave empty to use the store&apos;s delivery rate.</p>
        </div>
      </Surface>

      <Surface variant="clay" level={2} className="p-6 flex flex-col gap-5 rounded-2xl">
        <h2 className="font-heading text-lg font-semibold">Media</h2>
        <div>
          <Label className="mb-1">Images (max {MAX_IMAGES})</Label>
          <div className="flex gap-2 mb-2 flex-wrap">
            {form.images.map((img, index) => (
              <div key={img.id} className="flex flex-col gap-1 w-24">
                <div className="relative w-24 h-24 border border-border rounded-md overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="" className="object-cover w-full h-full" />
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    aria-label="Remove image"
                    className="absolute top-1 right-1 rounded-full size-5 shadow-sm"
                    onClick={() => removeImage(img.id)}
                  >
                    <X className="size-3" />
                  </Button>
                  {index === 0 ? (
                    <span className="absolute bottom-1 left-1 rounded bg-background/90 px-1 text-[10px] font-medium">Primary</span>
                  ) : null}
                </div>
                <div className="flex items-center justify-between">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Move image earlier"
                    className="size-6"
                    disabled={index === 0}
                    onClick={() => moveImage(index, index - 1)}
                  >
                    <ArrowLeft className="size-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Set as primary image"
                    className="size-6"
                    disabled={index === 0}
                    onClick={() => moveImage(index, 0)}
                  >
                    <Star className="size-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Move image later"
                    className="size-6"
                    disabled={index === form.images.length - 1}
                    onClick={() => moveImage(index, index + 1)}
                  >
                    <ArrowRight className="size-3" />
                  </Button>
                </div>
              </div>
            ))}
            {form.images.length < MAX_IMAGES && (
              <label className="w-24 h-24 border border-dashed border-border bg-card rounded-md flex items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors">
                <span className="text-2xl text-muted-foreground">+</span>
                <input type="file" multiple accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
              </label>
            )}
          </div>
        </div>
      </Surface>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="clay" disabled={saving || uploading || isInvalid}>
          {saving ? "Saving..." : isEdit ? "Save changes" : "Create product"}
        </Button>
        {product ? (
          <>
            <Button type="button" variant="clay-soft" disabled={saving || publishing} onClick={togglePublished}>
              {publishing ? "Working..." : published ? "Unpublish" : "Publish"}
            </Button>
            <StatusBadge status={published ? "published" : "draft"} />
            <span className="text-xs text-muted-foreground">Publishing uses the last saved version.</span>
          </>
        ) : null}
      </div>
    </form>
  );
}
