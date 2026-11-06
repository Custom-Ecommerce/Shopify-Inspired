"use client";

import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { useStoreHref } from "@/lib/dashboard-context";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { Surface } from "@/components/shared/Surface";

function slugify(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function paragraphsToLexical(text: string) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return {
    root: {
      type: "root",
      children: paragraphs.map((text) => ({
        type: "paragraph",
        children: [{ type: "text", text, version: 1 }],
        version: 1,
      })),
      direction: "ltr" as const,
      format: "" as const,
      indent: 0,
      version: 1,
    },
  };
}

function lexicalToParagraphs(content: unknown): string {
  const root = (content as { root?: { children?: { children?: { text?: string }[] }[] } })?.root;
  if (!root?.children) return "";
  return root.children
    .map((node) => (node.children ?? []).map((c) => c.text ?? "").join(""))
    .filter(Boolean)
    .join("\n\n");
}

interface ArticleData {
  id: string;
  title: string;
  slug: string;
  excerpt?: string | null;
  content?: unknown;
  type: string;
  status: string;
}

export function ArticleForm({ article }: { article?: ArticleData }) {
  const storeFetch = useStoreFetch();
  const href = useStoreHref();
  const router = useRouter();
  const isEdit = Boolean(article);

  const [title, setTitle] = useState(article?.title ?? "");
  const [slug, setSlug] = useState(article?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(isEdit);
  const [excerpt, setExcerpt] = useState(article?.excerpt ?? "");
  const [body, setBody] = useState(() => (article?.content ? lexicalToParagraphs(article.content) : ""));
  const [type, setType] = useState(article?.type ?? "blog");
  const [status, setStatus] = useState(article?.status ?? "draft");
  const [saving, setSaving] = useState(false);

  const titleError = title.length > 0 && title.trim().length < 3 ? "Title must be at least 3 characters." : null;
  const slugError = slugEdited && slug.includes(" ") ? "Slug cannot contain spaces." : null;
  const isInvalid = !!titleError || !!slugError || !title.trim();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const data = {
      title: title.trim(),
      slug: slugEdited ? slug : slugify(title),
      excerpt: excerpt.trim() || undefined,
      content: paragraphsToLexical(body),
      type,
      status,
      publishedAt: status === "published" ? new Date().toISOString() : undefined,
    };

    try {
      const url = isEdit ? `/api/dashboard/storeArticles/${article!.id}` : "/api/dashboard/storeArticles";
      const res = await storeFetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const resData = await res.json();
      if (!res.ok) {
        toast.error(resData?.errors?.[0]?.message ?? resData?.error ?? "Could not save this article.");
        return;
      }
      router.push(href("/blog"));
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
        <h2 className="font-heading text-lg font-semibold">Article Details</h2>
        <div>
          <Label htmlFor="title" className="mb-1">Title*</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          {titleError && <p className="text-xs text-destructive mt-1">{titleError}</p>}
        </div>

        <div>
          <Label htmlFor="slug" className="mb-1">Slug</Label>
          <Input
            id="slug"
            value={slugEdited ? slug : slugify(title)}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(slugify(e.target.value));
            }}
            className="font-mono"
          />
          {slugError && <p className="text-xs text-destructive mt-1">{slugError}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="mb-1">Type</Label>
            <Select value={type} onValueChange={(v) => { if (v) setType(v); }}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="blog">Blog</SelectItem>
                <SelectItem value="lookbook">Lookbook</SelectItem>
                <SelectItem value="size_guide">Size Guide</SelectItem>
                <SelectItem value="care_instructions">Care Instructions</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1">Status</Label>
            <Select value={status} onValueChange={(v) => { if (v) setStatus(v); }}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Surface>

      <Surface variant="clay" level={2} className="p-6 flex flex-col gap-5 rounded-2xl">
        <h2 className="font-heading text-lg font-semibold">Content</h2>
        <div>
          <Label htmlFor="excerpt" className="mb-1">Excerpt</Label>
          <Textarea
            id="excerpt"
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value.slice(0, 160))}
            maxLength={160}
            rows={2}
          />
        </div>

        <div>
          <Label htmlFor="body" className="mb-1">Content — separate paragraphs with a blank line</Label>
          <Textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} rows={12} className="font-mono" />
          <p className="text-xs text-muted-foreground mt-1">Plain text only — no formatting editor yet, see delivery report.</p>
        </div>
      </Surface>

      <Button type="submit" variant="clay" disabled={saving || isInvalid} className="self-start">
        {saving ? "Saving…" : isEdit ? "Save changes" : "Create article"}
      </Button>
    </form>
  );
}
