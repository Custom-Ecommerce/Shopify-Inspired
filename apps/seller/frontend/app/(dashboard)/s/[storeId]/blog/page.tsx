"use client";

import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { useStoreHref } from "@/lib/dashboard-context";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { StatusBadge } from "@/components/dashboard/shared/StatusBadge";
import { DataTable } from "@/components/dashboard/shared/DataTable";
import { LoadingState } from "@/components/dashboard/shared/LoadingState";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";

interface ArticleDoc {
  id: string;
  title: string;
  type: string;
  status: string;
  publishedAt?: string | null;
}

export default function DashboardBlogPage() {
  const storeFetch = useStoreFetch();
  const href = useStoreHref();
  const [articles, setArticles] = useState<ArticleDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    storeFetch("/api/dashboard/storeArticles")
      .then((res) => res.json())
      .then((data) => setArticles(data.docs ?? []))
      .finally(() => setIsLoading(false));
  }, [storeFetch]);

  const columns = [
    { header: "Title", accessorKey: "title" as keyof ArticleDoc },
    { 
      header: "Type", 
      render: (a: ArticleDoc) => <span className="capitalize">{a.type}</span> 
    },
    { 
      header: "Status", 
      render: (a: ArticleDoc) => <StatusBadge status={a.status} /> 
    },
    {
      header: "",
      render: (a: ArticleDoc) => (
        <div className="text-right">
          <Button variant="link" size="sm" className="h-auto p-0" render={<Link href={href(`/blog/${a.id}`)} />}>
            Edit
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 sm:p-8">
      <PageHeader title="Blog & Lookbook">
        <Button variant="clay" render={<Link href={href("/blog/new")} />}>New Article</Button>
      </PageHeader>

      {isLoading ? (
        <LoadingState />
      ) : articles.length === 0 ? (
        <EmptyState title="No articles yet" description="Start writing to engage your customers." />
      ) : (
        <SectionCard noPadding>
          <DataTable
            data={articles}
            columns={columns}
            keyExtractor={(a) => a.id}
          />
        </SectionCard>
      )}
    </div>
  );
}
