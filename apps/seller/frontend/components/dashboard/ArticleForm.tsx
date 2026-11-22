"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, X } from "lucide-react";
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
import {
  ARTICLE_LIMITS,
  articleFormProblems,
  articleFormToPayload,
  articleSlugify,
  articleToForm,
  effectiveSlug,
  emptyArticleForm,
  insertImageMarkdown,
  readArticleFailure,
  type ArticleDetail,
  type ArticleFormValues,
} from "@/lib/articles";

type Article = ArticleDetail & { coverImageUrl?: string | null };

function FieldError({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="mt-1 text-xs text-destructive">
      {message}
    </p>
  ) : null;
}

/**
 * Sprint 7 (S7-B2, CO-116): write or edit a blog article. The text is plain text with a small Markdown subset (headings, bold, italics, lists, links and
 * pictures from the media library); the preview shows exactly what the safe renderer will output. Saving sends the `revision` the form read: if the article
 * was changed elsewhere in the meantime the seller is told and nothing is overwritten.
 */
export function ArticleForm({ article }: { article?: Article }) {
  const storeFetch = useStoreFetch();
  const href = useStoreHref();
  const router = useRouter();
  const isEdit = Boolean(article);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [values, setValues] = useState<ArticleFormValues>(() => (article ? articleToForm(article) : emptyArticleForm()));
  const [coverUrl, setCoverUrl] = useState<string | null>(article?.coverImageUrl ?? null);
  const [revision, setRevision] = useState<number>(article?.revision ?? 0);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [picker, setPicker] = useState<null | "cover" | "inline">(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [touched, setTouched] = useState(false);

  const problems = articleFormProblems(values);
  const errors = { ...(touched ? problems : {}), ...serverErrors };
  const set = <K extends keyof ArticleFormValues>(key: K, value: ArticleFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setServerErrors((current) => {
      if (!(key in current)) return current;
      const { [key as string]: _gone, ...rest } = current;
      void _gone;
      return rest;
    });
  };

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    setConflict(false);
    if (Object.keys(problems).length > 0) return;
    setSaving(true);
    try {
      const url = isEdit ? `/api/dashboard/storeArticles/${article!.id}` : "/api/dashboard/storeArticles";
      const res = await storeFetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(articleFormToPayload(values, isEdit ? revision : undefined)),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const failure = readArticleFailure(res.status, body);
        if (failure.revisionConflict) setConflict(true);
        else if (failure.field) setServerErrors({ [failure.field]: failure.message });
        else toast.error(failure.message);
        if (failure.revisionConflict || failure.field) toast.error(failure.message);
        return;
      }
      toast.success(isEdit ? "Article saved." : "Article created.");
      router.push(href("/blog"));
      router.refresh();
    } catch {
      toast.error("Could not reach the backend. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!article || !window.confirm("Delete this article? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await storeFetch(`/api/dashboard/storeArticles/${article.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error(readArticleFailure(res.status, await res.json().catch(() => null), "Could not delete this article.").message);
        return;
      }
      toast.success("Article deleted.");
      router.push(href("/blog"));
      router.refresh();
    } catch {
      toast.error("Could not reach the backend. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  function insertImage(item: { alt: string; url: string; name?: string | null }) {
    const cursor = bodyRef.current?.selectionStart ?? values.content.length;
    const next = insertImageMarkdown(values.content, cursor, item.name || item.alt, item.url);
    set("content", next.content);
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-3xl flex-col gap-6" noValidate>
      {conflict ? (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
          <p className="font-medium text-destructive">This article was changed somewhere else.</p>
          <p className="mt-1">Your changes were not saved, so nothing was overwritten. Reload the article, then make your change again.</p>
          <Button type="button" variant="outline" className="mt-3 min-h-11" onClick={() => window.location.reload()}>
            Reload the article
          </Button>
        </div>
      ) : null}

      <Surface variant="clay" level={2} className="flex flex-col gap-5 rounded-2xl p-4 sm:p-6">
        <h2 className="font-heading text-lg font-semibold">Article details</h2>
        <div>
          <Label htmlFor="title" className="mb-1">Title*</Label>
          <Input id="title" value={values.title} onChange={(e) => set("title", e.target.value)} maxLength={ARTICLE_LIMITS.title.max + 20} className="min-h-11" aria-invalid={Boolean(errors.title)} />
          <FieldError message={errors.title} />
        </div>

        <div>
          <Label htmlFor="slug" className="mb-1">Web address</Label>
          <Input
            id="slug"
            value={effectiveSlug(values)}
            onChange={(e) => {
              setValues((current) => ({ ...current, slugEdited: true, slug: articleSlugify(e.target.value) }));
              setServerErrors(({ slug: _slug, ...rest }) => (void _slug, rest));
            }}
            className="min-h-11 font-mono"
            aria-invalid={Boolean(errors.slug)}
          />
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
      </Surface>

      <Surface variant="clay" level={2} className="flex flex-col gap-5 rounded-2xl p-4 sm:p-6">
        <h2 className="font-heading text-lg font-semibold">Content</h2>

        <div>
          <Label className="mb-1">Cover picture</Label>
          {values.coverImage ? (
            <div className="flex items-center gap-3">
              {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverUrl} alt="" className="size-20 rounded-lg border object-cover" />
              ) : (
                <span className="text-sm text-muted-foreground">A picture is selected.</span>
              )}
              <Button type="button" variant="outline" className="min-h-11" onClick={() => { set("coverImage", null); setCoverUrl(null); }}>
                <X className="size-4" aria-hidden="true" /> Remove
              </Button>
            </div>
          ) : null}
          <Button type="button" variant="outline" className="mt-2 min-h-11" onClick={() => setPicker("cover")}>
            <ImagePlus className="size-4" aria-hidden="true" /> {values.coverImage ? "Change cover" : "Choose cover"}
          </Button>
          <FieldError message={errors.coverImage} />
        </div>

        <div>
          <Label htmlFor="excerpt" className="mb-1">Summary</Label>
          <Textarea id="excerpt" value={values.excerpt} onChange={(e) => set("excerpt", e.target.value)} rows={2} aria-invalid={Boolean(errors.excerpt)} />
          <p className="mt-1 text-xs text-muted-foreground">{values.excerpt.trim().length} / {ARTICLE_LIMITS.excerpt}</p>
          <FieldError message={errors.excerpt} />
        </div>

        <div>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="body">Text</Label>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => setPicker("inline")}>
                <ImagePlus className="size-4" aria-hidden="true" /> Add picture
              </Button>
              <Button type="button" variant="outline" size="sm" className="min-h-11" aria-pressed={showPreview} onClick={() => setShowPreview((on) => !on)}>
                {showPreview ? "Edit" : "Preview"}
              </Button>
            </div>
          </div>
          {showPreview ? (
            <div className="min-h-40 rounded-lg border bg-background p-3">
              <ContentPreview content={values.content} />
            </div>
          ) : (
            <Textarea id="body" ref={bodyRef} value={values.content} onChange={(e) => set("content", e.target.value)} rows={14} className="font-mono" aria-invalid={Boolean(errors.content)} />
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Plain text. Use # for a heading, **bold**, *italic*, - for a list and [text](https://link) for a link. Pictures come from your media library. {values.content.length.toLocaleString()} / 50,000
          </p>
          <FieldError message={errors.content} />
        </div>

        <div>
          <Label htmlFor="tags" className="mb-1">Tags</Label>
          <Input id="tags" value={values.tagsText} onChange={(e) => set("tagsText", e.target.value)} placeholder="eid, lawn, care" className="min-h-11" aria-invalid={Boolean(errors.tags)} />
          <p className="mt-1 text-xs text-muted-foreground">Separate with commas. At most {ARTICLE_LIMITS.tags}.</p>
          <FieldError message={errors.tags} />
        </div>
      </Surface>

      <Surface variant="clay" level={2} className="flex flex-col gap-5 rounded-2xl p-4 sm:p-6">
        <h2 className="font-heading text-lg font-semibold">Search engines</h2>
        <div>
          <Label htmlFor="seoTitle" className="mb-1">Search title</Label>
          <Input id="seoTitle" value={values.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} className="min-h-11" aria-invalid={Boolean(errors.seoTitle)} />
          <FieldError message={errors.seoTitle} />
        </div>
        <div>
          <Label htmlFor="seoDescription" className="mb-1">Search description</Label>
          <Textarea id="seoDescription" value={values.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} rows={2} aria-invalid={Boolean(errors.seoDescription)} />
          <FieldError message={errors.seoDescription} />
        </div>
      </Surface>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="clay" className="min-h-11" disabled={saving || deleting}>
          {saving ? "Saving…" : isEdit ? "Save changes" : "Create article"}
        </Button>
        {isEdit ? (
          <Button type="button" variant="destructive" className="min-h-11" disabled={saving || deleting} onClick={() => void handleDelete()}>
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        ) : null}
      </div>

      <MediaPickerDialog
        open={picker !== null}
        onOpenChange={(open) => { if (!open) setPicker(null); }}
        title={picker === "cover" ? "Choose the cover picture" : "Add a picture to the text"}
        onPick={(item) => {
          if (picker === "cover") {
            set("coverImage", item.id);
            setCoverUrl(item.url);
          } else {
            insertImage(item);
          }
        }}
      />
    </form>
  );
}
