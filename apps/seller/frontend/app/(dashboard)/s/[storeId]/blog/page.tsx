"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { StatusBadge } from "@/components/dashboard/shared/StatusBadge";
import { LoadingState } from "@/components/dashboard/shared/LoadingState";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";
import { ErrorState } from "@/components/dashboard/shared/ErrorState";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { useStoreHref } from "@/lib/dashboard-context";
import { ARTICLE_STATUS_FILTERS, articleListUrl, articleStatusLabel, formatArticleDate, type ArticleListItem } from "@/lib/articles";
import { cn } from "@/lib/utils";

/** Sprint 7 (S7-B2): the blog list, with a status filter (all, drafts, published) and a title search. No plan limit applies to it. */
export default function DashboardBlogPage() {
  const storeFetch = useStoreFetch();
  const href = useStoreHref();
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"" | "draft" | "published">("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  // The search waits for a pause in typing before it asks the backend.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    storeFetch(articleListUrl({ status, q: query }), { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { docs?: ArticleListItem[]; error?: string } | null;
        if (cancelled) return;
        if (!res.ok || !Array.isArray(data?.docs)) setError(data?.error ?? "Could not load your articles.");
        else {
          setArticles(data.docs);
          setError(null);
        }
      })
      .catch(() => !cancelled && setError("Could not reach the backend. Please try again."))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [storeFetch, status, query]);

  const filtered = status !== "" || query.trim() !== "";

  return (
    <div className="p-4 sm:p-8">
      <PageHeader title="Blog">
        <Button variant="clay" className="min-h-11" render={<Link href={href("/blog/new")} />}>
          New article
        </Button>
      </PageHeader>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
          {ARTICLE_STATUS_FILTERS.map((filter) => (
            <Button
              key={filter.value}
              type="button"
              variant={status === filter.value ? "default" : "outline"}
              className={cn("min-h-11")}
              aria-pressed={status === filter.value}
              onClick={() => setStatus(filter.value)}
            >
              {filter.label}
            </Button>
          ))}
        </div>
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by title" aria-label="Search articles by title" className="min-h-11 pl-9" />
        </div>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : articles.length === 0 ? (
        <EmptyState
          title={filtered ? "No article matches" : "No articles yet"}
          description={filtered ? "Try another filter or search." : "Start writing to engage your customers."}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {articles.map((article) => (
            <li key={article.id} className="flex flex-col gap-2 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="break-words font-medium">{article.title}</p>
                <p className="text-xs text-muted-foreground">
                  /{article.slug}
                  {article.status === "published" && article.publishedAt ? ` · published ${formatArticleDate(article.publishedAt)}` : ""}
                </p>
              </div>
              <div className="flex items-center justify-between gap-3 sm:justify-end">
                <StatusBadge status={article.status} label={articleStatusLabel(article.status)} />
                <Button variant="outline" className="min-h-11" render={<Link href={href(`/blog/${article.id}`)} />}>
                  Edit
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
