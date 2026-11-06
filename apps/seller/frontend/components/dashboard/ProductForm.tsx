"use client";

import type { Product as PayloadProductDoc, Category as PayloadCategoryDoc, StockStatus as PayloadStockStatus } from "@markaz/contracts";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { useStoreHref } from "@/lib/dashboard-context";
import { firstVariant, stockStatusOf } from "@/lib/product-stock";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Surface } from "@/components/shared/Surface";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  price: string;
  originalPrice: string;
  description: string;
  categoryId: string;
  stockStatus: PayloadStockStatus;
  stockQuantity: string;
  isFeatured: boolean;
  highlights: string[];
  images: ImageEntry[];
}

function initialStateFromProduct(product?: PayloadProductDoc): FormState {
  const variant = product ? firstVariant(product) : undefined;
  return {
    title: product?.title ?? "",
    slug: product?.slug ?? "",
    price: variant ? String(variant.price) : "",
    originalPrice: variant?.compareAtPrice != null ? String(variant.compareAtPrice) : "",
    description: product?.description ?? "",
    categoryId:
      (typeof product?.categories?.[0] === "object" ? product.categories[0]?.id : product?.categories?.[0]) ?? "",
    stockStatus: variant ? stockStatusOf(variant) : "in_stock",
    stockQuantity: variant ? String(variant.stockQuantity) : "0",
    isFeatured: product?.isFeatured ?? false,
    highlights: (product?.highlights ?? []).map((h) => h.text),
    images: (product?.media ?? [])
      .filter((m): m is Exclude<typeof m, string> => typeof m === "object" && m !== null)
      .map((m) => ({ id: m.id, url: m.url ?? "" })),
  };
}

export function ProductForm({ product }: { product?: PayloadProductDoc }) {
  const storeFetch = useStoreFetch();
  const href = useStoreHref();
  const router = useRouter();
  const isEdit = Boolean(product);

  const [form, setForm] = useState<FormState>(() => initialStateFromProduct(product));
  const [categories, setCategories] = useState<PayloadCategoryDoc[]>([]);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    storeFetch("/api/proxy/categories?limit=200&depth=0")
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
    const remaining = 5 - form.images.length;
    if (remaining <= 0) {
      toast.error("Maximum 5 images per product.");
      return;
    }
    const toUpload = files.slice(0, remaining);
    setUploading(true);
    try {
      for (const file of toUpload) {
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

  const titleError = form.title.length > 0 && form.title.trim().length < 3 ? "Title must be at least 3 characters." : null;
  const priceError = form.price !== "" && Number(form.price) <= 0 ? "Price must be greater than 0." : null;
  const slugError = form.slug.includes(" ") ? "Slug cannot contain spaces." : null;
  const isInvalid = !!titleError || !!priceError || !!slugError || !form.title.trim() || !form.price || !form.description.trim() || !form.categoryId;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.title.trim() || !form.price || !form.description.trim() || !form.categoryId) {
      toast.error("Title, price, description, and category are required.");
      return;
    }
    if (form.images.length === 0) {
      toast.error("At least one product image is required.");
      return;
    }

    setSaving(true);
    const data = {
      title: form.title.trim(),
      slug: form.slug,
      price: Number(form.price),
      originalPrice: form.originalPrice ? Number(form.originalPrice) : undefined,
      description: form.description.trim(),
      categories: [form.categoryId],
      stockStatus: form.stockStatus,
      stockQuantity: Number(form.stockQuantity) || 0,
      isFeatured: form.isFeatured,
      highlights: form.highlights.filter((h) => h.trim()).map((text) => ({ text: text.trim() })),
      media: form.images.map((img) => img.id),
    };

    try {
      const url = isEdit ? `/api/dashboard/products/${product!.id}` : "/api/dashboard/products";
      const res = await storeFetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const resData = await res.json();
      if (!res.ok) {
        toast.error(resData?.errors?.[0]?.message ?? resData?.error ?? "Could not save this product.");
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
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            required
          />
          {titleError && <p className="text-xs text-destructive mt-1">{titleError}</p>}
        </div>

        <div>
          <Label htmlFor="slug" className="mb-1">Slug</Label>
          <Input
            id="slug"
            value={form.slug}
            onChange={(e) => setForm((f) => ({ ...f, slug: slugify(e.target.value) }))}
            className="font-mono"
          />
          {slugError && <p className="text-xs text-destructive mt-1">{slugError}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="price" className="mb-1">Price (PKR)*</Label>
            <Input
              id="price"
              type="number"
              min={0}
              value={form.price}
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              required
            />
            {priceError && <p className="text-xs text-destructive mt-1">{priceError}</p>}
          </div>
          <div>
            <Label htmlFor="originalPrice" className="mb-1">Original price (PKR)</Label>
            <Input
              id="originalPrice"
              type="number"
              min={0}
              value={form.originalPrice}
              onChange={(e) => setForm((f) => ({ ...f, originalPrice: e.target.value }))}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="description" className="mb-1">Description*</Label>
          <Textarea
            id="description"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            required
            rows={5}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="mb-1">Category*</Label>
            <Select
              value={form.categoryId}
              onValueChange={(v) => { if (v) setForm((f) => ({ ...f, categoryId: v })); }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {categoriesLoaded && categories.length === 0 ? (
              <Link href={href("/categories")} className="mt-1 inline-block text-xs font-medium underline underline-offset-4">
                Create a category first
              </Link>
            ) : null}
          </div>
          <div>
            <Label className="mb-1">Stock Status</Label>
            <Select
              value={form.stockStatus}
              onValueChange={(v) => { if (v) setForm((f) => ({ ...f, stockStatus: v as PayloadStockStatus })); }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in_stock">In Stock</SelectItem>
                <SelectItem value="out_of_stock">Out of Stock</SelectItem>
                <SelectItem value="on_backorder">On Backorder</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="isFeatured"
            checked={form.isFeatured}
            onCheckedChange={(checked) => setForm((f) => ({ ...f, isFeatured: checked === true }))}
          />
          <Label htmlFor="isFeatured">Feature this product on homepage</Label>
        </div>
      </Surface>

      <Surface variant="clay" level={2} className="p-6 flex flex-col gap-5 rounded-2xl">
        <h2 className="font-heading text-lg font-semibold">Media</h2>
        <div>
          <Label className="mb-1">Images (max 5)*</Label>
          <div className="flex gap-2 mb-2 flex-wrap">
            {form.images.map((img) => (
              <div key={img.id} className="relative w-20 h-20 border border-border rounded-md overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="" className="object-cover w-full h-full" />
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="absolute top-1 right-1 rounded-full size-5 shadow-sm"
                  onClick={() => removeImage(img.id)}
                >
                  <X className="size-3" />
                </Button>
              </div>
            ))}
            {form.images.length < 5 && (
              <label className="w-20 h-20 border border-dashed border-border bg-card rounded-md flex items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors">
                <span className="text-2xl text-muted-foreground">+</span>
                <input type="file" multiple accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
              </label>
            )}
          </div>
        </div>
      </Surface>

      <Button type="submit" variant="clay" disabled={saving || uploading || isInvalid} className="self-start">
        {saving ? "Saving..." : isEdit ? "Save changes" : "Create product"}
      </Button>
    </form>
  );
}
