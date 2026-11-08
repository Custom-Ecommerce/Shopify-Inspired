"use client";

import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { useState } from "react";
import { useDashboard } from "@/lib/dashboard-context";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";

interface FormState {
  announcementText: string;
  whatsappNumber: string;
  deliveryRate: number;
  freeDeliveryThreshold: number;
  activeTheme: string;
  logo: string | null;
  logoUrl: string | null;
  seoTitle: string;
  seoDescription: string;
  seoImage: string | null;
  seoImageUrl: string | null;
}

export default function DashboardStorePage() {
  const storeFetch = useStoreFetch();
  const { store, storeId } = useDashboard();

  const [form, setForm] = useState<FormState>(() => ({
    announcementText: store?.storefront?.announcementText ?? "",
    whatsappNumber: store?.storefront?.whatsappNumber ?? "",
    deliveryRate: store?.storefront?.deliveryRate ?? 0,
    freeDeliveryThreshold: store?.storefront?.freeDeliveryThreshold ?? 5000,
    // A store with no theme set renders with the storefront's fallback, Mustafa, so that is what it shows. New stores are
    // created with Stiletto (D-059). Theme ids are the storefront registry's (packages/platform-kit/src/themes/manifest.ts).
    activeTheme: store?.storefront?.activeTheme ?? "mustafa",
    logo:
      typeof store?.storefront?.logo === "object"
        ? (store.storefront.logo?.id ?? null)
        : (store?.storefront?.logo ?? null),
    logoUrl:
      typeof store?.storefront?.logo === "object"
        ? (store.storefront.logo?.url ?? null)
        : null,
    seoTitle: store?.storefront?.seoTitle ?? "",
    seoDescription: store?.storefront?.seoDescription ?? "",
    seoImage:
      typeof store?.storefront?.seoImage === "object"
        ? (store.storefront.seoImage?.id ?? null)
        : (store?.storefront?.seoImage ?? null),
    seoImageUrl:
      typeof store?.storefront?.seoImage === "object"
        ? (store.storefront.seoImage?.url ?? null)
        : null,
  }));
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  if (!store) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="font-heading text-2xl font-semibold mb-2">
          Store Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Store details could not be loaded. Try refreshing the page.
        </p>
      </div>
    );
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("alt", `${store!.name} logo`);
      const res = await storeFetch("/api/proxy/media", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setMessage({
          type: "error",
          text: data?.error ?? "Logo upload failed.",
        });
        return;
      }
      const doc = data.doc ?? data;
      setForm((f) => ({ ...f, logo: doc.id, logoUrl: doc.url ?? null }));
    } catch {
      setMessage({
        type: "error",
        text: "Could not reach the backend. Please try again.",
      });
    } finally {
      setUploading(false);
    }
  }

  async function handleSeoImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("alt", `${store!.name} SEO image`);
      const res = await storeFetch("/api/proxy/media", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setMessage({
          type: "error",
          text: data?.error ?? "Image upload failed.",
        });
        return;
      }
      const doc = data.doc ?? data;
      setForm((f) => ({
        ...f,
        seoImage: doc.id,
        seoImageUrl: doc.url ?? null,
      }));
    } catch {
      setMessage({
        type: "error",
        text: "Could not reach the backend. Please try again.",
      });
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await storeFetch(`/api/proxy/stores/${encodeURIComponent(storeId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storefront: {
            announcementText: form.announcementText,
            whatsappNumber: form.whatsappNumber,
            deliveryRate: form.deliveryRate,
            freeDeliveryThreshold: form.freeDeliveryThreshold,
            activeTheme: form.activeTheme,
            seoTitle: form.seoTitle,
            seoDescription: form.seoDescription,
            ...(form.logo ? { logo: form.logo } : {}),
            ...(form.seoImage ? { seoImage: form.seoImage } : {}),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({
          type: "error",
          text: data?.error ?? data?.errors?.[0]?.message ?? "Save failed.",
        });
        return;
      }
      setMessage({ type: "success", text: "Store settings saved." });
    } catch {
      setMessage({
        type: "error",
        text: "Could not reach the backend. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 sm:p-8 max-w-2xl flex flex-col gap-6">
      <PageHeader title="Store Settings" description={store.name} className="mb-0" />

      {/* Read-only store info */}
      <SectionCard title="Store">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
              Slug
            </p>
            <p className="font-mono">{store.slug}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
              Internal Handle
            </p>
            <p className="font-mono">{store.internalHandle}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
              Commission Rate
            </p>
            <p>{store.commissionRate}%</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
              Status
            </p>
            <p className="capitalize">{store.status}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
              Custom Domain Status
            </p>
            <p className="capitalize">{store.customDomainStatus}</p>
          </div>
        </div>
      </SectionCard>

      {/* Editable settings */}
      <SectionCard title="Storefront">
        <div className="flex flex-col gap-5">
          <div>
            <Label htmlFor="announcementText" className="mb-1">
              Announcement text
            </Label>
            <Input
              id="announcementText"
              value={form.announcementText}
              onChange={(e) =>
                setForm((f) => ({ ...f, announcementText: e.target.value }))
              }
            />
          </div>

          <div>
            <Label htmlFor="whatsappNumber" className="mb-1">
              WhatsApp number
            </Label>
            <Input
              id="whatsappNumber"
              value={form.whatsappNumber}
              onChange={(e) =>
                setForm((f) => ({ ...f, whatsappNumber: e.target.value }))
              }
              placeholder="923001234567"
              className="font-mono"
            />
          </div>

          <div>
            <Label className="mb-1">Logo</Label>
            <Avatar className="w-20 h-20 rounded-md border mb-2">
              <AvatarImage src={form.logoUrl || ""} className="object-cover" />
              <AvatarFallback className="rounded-md text-2xl">
                {store.name?.[0]?.toUpperCase() || "S"}
              </AvatarFallback>
            </Avatar>
            <Label className="cursor-pointer">
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                disabled={uploading}
                className="text-sm"
              />
            </Label>
          </div>

          <div>
            <Label className="mb-1">Active theme</Label>
            <Select
              value={form.activeTheme}
              onValueChange={(v) => {
                if (v)
                  setForm((f) => ({
                    ...f,
                    activeTheme: v as string,
                  }));
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stiletto">Stiletto</SelectItem>
                <SelectItem value="mustafa">Mustafa</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="deliveryRate" className="mb-1">
                Delivery rate (PKR)
              </Label>
              <Input
                id="deliveryRate"
                type="number"
                min={0}
                value={form.deliveryRate}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    deliveryRate: Number(e.target.value),
                  }))
                }
              />
            </div>
            <div>
              <Label htmlFor="freeDeliveryThreshold" className="mb-1">
                Free delivery threshold (PKR)
              </Label>
              <Input
                id="freeDeliveryThreshold"
                type="number"
                min={0}
                value={form.freeDeliveryThreshold}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    freeDeliveryThreshold: Number(e.target.value),
                  }))
                }
              />
            </div>
          </div>

          {/* Save feedback — semantic tokens, no Alert primitive */}
          {message && (
            <p
              className={
                message.type === "success"
                  ? "text-sm text-success"
                  : "text-sm text-destructive"
              }
            >
              {message.text}
            </p>
          )}

          <Button
            variant="clay"
            onClick={handleSave}
            disabled={saving || uploading}
            className="self-start"
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </SectionCard>

      {/* SEO */}
      <SectionCard title="SEO">
        <div className="flex flex-col gap-5">
          <div>
            <Label htmlFor="seoTitle" className="mb-1">
              SEO title
            </Label>
            <Input
              id="seoTitle"
              value={form.seoTitle}
              onChange={(e) =>
                setForm((f) => ({ ...f, seoTitle: e.target.value }))
              }
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label htmlFor="seoDescription">SEO description</Label>
              <span
                className={`text-xs font-mono ${form.seoDescription.length > 160 ? "text-destructive" : "text-muted-foreground"}`}
              >
                {form.seoDescription.length}/160
              </span>
            </div>
            <Textarea
              id="seoDescription"
              value={form.seoDescription}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  seoDescription: e.target.value.slice(0, 160),
                }))
              }
              rows={3}
              maxLength={160}
            />
          </div>
          <div>
            <Label className="mb-1">SEO image (social preview)</Label>
            {form.seoImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={form.seoImageUrl}
                alt="SEO preview"
                className="h-24 w-24 object-cover mb-2 rounded-xl border"
              />
            )}
            <Label className="cursor-pointer">
              <input
                type="file"
                accept="image/*"
                onChange={handleSeoImageUpload}
                disabled={uploading}
                className="text-sm"
              />
            </Label>
          </div>

          {message && (
            <p
              className={
                message.type === "success"
                  ? "text-sm text-success"
                  : "text-sm text-destructive"
              }
            >
              {message.text}
            </p>
          )}

          <Button
            variant="clay"
            onClick={handleSave}
            disabled={saving || uploading}
            className="self-start"
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}
