"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { StatusBadge } from "@/components/dashboard/shared/StatusBadge";
import { LoadingState } from "@/components/dashboard/shared/LoadingState";
import { ErrorState } from "@/components/dashboard/shared/ErrorState";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";
import { useRouter } from "next/navigation";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { useStoreHref } from "@/lib/dashboard-context";
import { createPageFromTemplate, fetchPages, pageStatusLabel, type PageListAnswer } from "@/lib/pages";

/**
 * Sprint 7 (S7-B3): the pages manager. The seller's pages with their status and footer setting, and the five default templates (about, contact, shipping,
 * returns, privacy). Opening this screen creates NOTHING: a default page exists only after the seller chooses "Create from template" for it, and it starts as a
 * draft.
 */
export default function DashboardPagesPage() {
  const storeFetch = useStoreFetch();
  const href = useStoreHref();
  const router = useRouter();
  const [data, setData] = useState<PageListAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchPages(storeFetch);
    if (result.ok) {
      setData(result.value);
      setError(null);
    } else {
      setError(result.failure.message);
    }
  }, [storeFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  async function useTemplate(key: string) {
    setBusy(key);
    const result = await createPageFromTemplate(storeFetch, key);
    setBusy(null);
    if (!result.ok) {
      toast.error(result.failure.message);
      await load();
      return;
    }
    toast.success("Page created as a draft. Edit it, then publish.");
    router.push(href(`/pages/${result.value.id}`));
  }

  return (
    <div className="p-4 sm:p-8">
      <PageHeader title="Pages" description="About, contact, shipping, returns and any page you write. Published pages can be linked in the footer.">
        <Button variant="clay" className="min-h-11" render={<Link href={href("/pages/new")} />}>
          New page
        </Button>
      </PageHeader>

      {error ? (
        <ErrorState message={error} />
      ) : data === null ? (
        <LoadingState />
      ) : (
        <div className="flex flex-col gap-10">
          {data.pages.length === 0 ? (
            <EmptyState title="No pages yet" description="Start from a template below, or write your own page." />
          ) : (
            <ul className="flex flex-col gap-3">
              {data.pages.map((page) => (
                <li key={page.id} className="flex flex-col gap-2 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="break-words font-medium">{page.title}</p>
                    <p className="text-xs text-muted-foreground">
                      /pages/{page.slug}
                      {page.showInFooter ? " · in the footer" : ""}
                      {page.hasPlaceholder ? " · still has placeholders" : ""}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <StatusBadge status={page.status} label={pageStatusLabel(page.status)} />
                    <Button variant="outline" className="min-h-11" render={<Link href={href(`/pages/${page.id}`)} />}>
                      Edit
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <section aria-labelledby="templates-heading">
            <h2 id="templates-heading" className="font-heading text-lg font-semibold">Templates</h2>
            <p className="mt-1 text-sm text-muted-foreground">Each template becomes a draft page you can edit. Pages marked legal need your own wording before you publish.</p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {data.templates.map((template) => (
                <li key={template.key} className="flex items-center justify-between gap-3 rounded-xl border p-4">
                  <div className="min-w-0">
                    <p className="font-medium">{template.title}</p>
                    <p className="text-xs text-muted-foreground">{template.legal ? "Legal page: edit before publishing" : "Starter text you can edit"}</p>
                  </div>
                  {template.exists ? (
                    <span className="shrink-0 text-xs text-muted-foreground">Already created</span>
                  ) : (
                    <Button type="button" variant="outline" className="min-h-11 shrink-0" disabled={busy !== null} onClick={() => void useTemplate(template.key)}>
                      {busy === template.key ? "Creating…" : "Create from template"}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
