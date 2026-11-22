"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Surface } from "@/components/shared/Surface";
import { ContentPreview } from "@/components/dashboard/ContentPreview";
import { MediaPickerDialog } from "@/components/dashboard/media/MediaPickerDialog";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { useStoreHref } from "@/lib/dashboard-context";
import { insertImageMarkdown, articleSlugify } from "@/lib/articles";
import {
  PAGE_LIMITS,
  effectivePageSlug,
  emptyPageForm,
  pageFormProblems,
  pageFormToPayload,
  pageToForm,
  placeholderWarning,
  publishConfirmationMessage,
  publishNeedsConfirmation,
  readPageFailure,
  type PageDetail,
  type PageFormValues,
} from "@/lib/pages";

function FieldError({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="mt-1 text-xs text-destructive">
      {message}
    </p>
  ) : null;
}

/**
 * Sprint 7 (S7-B3): write or edit a static page of the store. The text is plain text with the small Markdown subset (the same editor and preview as the
 * blog). A page made from a template still holds `[[EDIT: ...]]` placeholders: while one is in the text a warning shows, and publishing asks for confirmation.
 * Saving sends the `revision` the form read: a change made elsewhere in the meantime is told, never overwritten.
 */
export function PageForm({ page }: { page?: PageDetail }) {
  const storeFetch = useStoreFetch();
  const href = useStoreHref();
  const router = useRouter();
  const isEdit = Boolean(page);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [values, setValues] = useState<PageFormValues>(() => (page ? pageToForm(page) : emptyPageForm()));
  const [revision] = useState<number>(page?.revision ?? 0);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [picker, setPicker] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [touched, setTouched] = useState(false);

  const problems = pageFormProblems(values);
  const errors = { ...(touched ? problems : {}), ...serverErrors };
  const warning = placeholderWarning(values.body);

  const set = <K extends keyof PageFormValues>(key: K, value: PageFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setServerErrors((current) => {
      const field = key === "sortOrderText" ? "sortOrder" : (key as string);
      if (!(field in current)) return current;
      const { [field]: _gone, ...rest } = current;
      void _gone;
      return rest;
    });
  };

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    setConflict(false);
    if (Object.keys(problems).length > 0) return;
    if (publishNeedsConfirmation(values) && !window.confirm(publishConfirmationMessage(values.body))) return;
    setSaving(true);
    try {
      const url = isEdit ? `/api/dashboard/storePages/${page!.id}` : "/api/dashboard/storePages";
      const res = await storeFetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pageFormToPayload(values, isEdit ? revision : undefined)),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const failure = readPageFailure(res.status, body);
        if (failure.revisionConflict) setConflict(true);
        else if (failure.field) setServerErrors({ [failure.field]: failure.message });
        toast.error(failure.message);
        return;
      }
      toast.success(isEdit ? "Page saved." : "Page created.");
      router.push(href("/pages"));
      router.refresh();
    } catch {
      toast.error("Could not reach the backend. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!page || !window.confirm("Delete this page? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await storeFetch(`/api/dashboard/storePages/${page.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error(readPageFailure(res.status, await res.json().catch(() => null), "Could not delete this page.").message);
        return;
      }
      toast.success("Page deleted.");
      router.push(href("/pages"));
      router.refresh();
    } catch {
      toast.error("Could not reach the backend. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-3xl flex-col gap-6" noValidate>
      {conflict ? (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
          <p className="font-medium text-destructive">This page was changed somewhere else.</p>
          <p className="mt-1">Your changes were not saved, so nothing was overwritten. Reload the page, then make your change again.</p>
          <Button type="button" variant="outline" className="mt-3 min-h-11" onClick={() => window.location.reload()}>
            Reload the page
          </Button>
        </div>
      ) : null}

      {warning ? (
        <div role="status" data-testid="placeholder-warning" className="flex gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>{warning}</p>
        </div>
      ) : null}

      <Surface variant="clay" level={2} className="flex flex-col gap-5 rounded-2xl p-4 sm:p-6">
        <h2 className="font-heading text-lg font-semibold">Page details</h2>
        <div>
          <Label htmlFor="title" className="mb-1">Title*</Label>
          <Input id="title" value={values.title} onChange={(e) => set("title", e.target.value)} className="min-h-11" aria-invalid={Boolean(errors.title)} />
          <FieldError message={errors.title} />
        </div>

        <div>
          <Label htmlFor="slug" className="mb-1">Web address</Label>
          <Input
            id="slug"
            value={effectivePageSlug(values)}
            onChange={(e) => {
              setValues((current) => ({ ...current, slugEdited: true, slug: articleSlugify(e.target.value) }));
              setServerErrors(({ slug: _slug, ...rest }) => (void _slug, rest));
            }}
            className="min-h-11 font-mono"
            aria-invalid={Boolean(errors.slug)}
          />
          <p className="mt-1 text-xs text-muted-foreground">Your page is at /pages/{effectivePageSlug(values) || "…"}</p>
          <FieldError message={errors.slug} />
        </div>

        <div>
          <Label className="mb-1">Status</Label>
          <Select value={values.status} onValueChange={(v) => { if (v === "draft" || v === "published") set("status", v); }}>
            <SelectTrigger className="min-h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft (only you can see it)</SelectItem>
              <SelectItem value="published">Published (shoppers can read it)</SelectItem>
            </SelectContent>
          </Select>
          <FieldError message={errors.status} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" className="size-5" checked={values.showInFooter} onChange={(e) => set("showInFooter", e.target.checked)} />
            <span>Link to this page in the footer</span>
          </label>
          <div>
            <Label htmlFor="sortOrder" className="mb-1">Footer order</Label>
            <Input id="sortOrder" inputMode="numeric" value={values.sortOrderText} onChange={(e) => set("sortOrderText", e.target.value)} className="min-h-11" aria-invalid={Boolean(errors.sortOrder)} />
            <p className="mt-1 text-xs text-muted-foreground">Lower numbers come first.</p>
            <FieldError message={errors.sortOrder} />
          </div>
        </div>
      </Surface>

      <Surface variant="clay" level={2} className="flex flex-col gap-5 rounded-2xl p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-lg font-semibold">Text</h2>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => setPicker(true)}>
              <ImagePlus className="size-4" aria-hidden="true" /> Add picture
            </Button>
            <Button type="button" variant="outline" size="sm" className="min-h-11" aria-pressed={showPreview} onClick={() => setShowPreview((on) => !on)}>
              {showPreview ? "Edit" : "Preview"}
            </Button>
          </div>
        </div>
        {showPreview ? (
          <div className="min-h-40 rounded-lg border bg-background p-3">
            <ContentPreview content={values.body} />
          </div>
        ) : (
          <Textarea id="body" ref={bodyRef} value={values.body} onChange={(e) => set("body", e.target.value)} rows={16} className="font-mono" aria-label="Page text" aria-invalid={Boolean(errors.body)} />
        )}
        <p className="text-xs text-muted-foreground">
          Plain text. Use # for a heading, **bold**, *italic*, - for a list and [text](https://link) for a link. Pictures come from your media library. {values.body.length.toLocaleString()} / {PAGE_LIMITS.body.toLocaleString()}
        </p>
        <FieldError message={errors.body} />
      </Surface>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="clay" className="min-h-11" disabled={saving || deleting}>
          {saving ? "Saving…" : values.status === "published" ? (isEdit ? "Save and publish" : "Create and publish") : isEdit ? "Save changes" : "Create page"}
        </Button>
        {isEdit ? (
          <Button type="button" variant="destructive" className="min-h-11" disabled={saving || deleting} onClick={() => void handleDelete()}>
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        ) : null}
      </div>

      <MediaPickerDialog
        open={picker}
        onOpenChange={setPicker}
        title="Add a picture to the page"
        onPick={(item) => {
          const cursor = bodyRef.current?.selectionStart ?? values.body.length;
          set("body", insertImageMarkdown(values.body, cursor, item.name || item.alt, item.url).content);
        }}
      />
    </form>
  );
}
