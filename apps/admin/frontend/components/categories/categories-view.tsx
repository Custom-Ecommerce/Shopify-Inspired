"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { CategoryFormDialog, type CategoryEditor } from "@/components/categories/category-form-dialog";
import { DeleteCategoryDialog } from "@/components/categories/delete-category-dialog";
import { DataTable, TablePagination, type Column } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listCategories } from "@/lib/api/client";
import { categoryStateToQuery, parseCategoryState, type CategoryListState } from "@/lib/categories";
import type { AdminCategory } from "@/lib/contracts";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";
import { useDebouncedSearch } from "@/lib/hooks/use-debounced-search";

/** The platform categories at /categories. Search and page live in the URL. Create, edit, and delete open dialogs. */
export function CategoriesView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = useMemo(() => parseCategoryState(searchParams), [searchParams]);
  const [editor, setEditor] = useState<CategoryEditor | null>(null);
  const [removing, setRemoving] = useState<AdminCategory | null>(null);

  function go(next: CategoryListState) {
    const query = categoryStateToQuery(next);
    router.replace(query === "" ? pathname : pathname + "?" + query);
  }

  const [search, setSearch] = useDebouncedSearch(state.q, (q) => go({ ...state, q, page: 1 }));
  const { data, error, loading, refetch } = useAdminFetch((signal) => listCategories(state, signal), [state.page, state.q]);

  useEffect(() => {
    if (data && data.totalPages > 0 && state.page > data.totalPages) go({ ...state, page: data.totalPages });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const columns = useMemo<Array<Column<AdminCategory>>>(
    () => [
      { key: "order", header: "Order", className: "w-20", cell: (category) => <span className="tabular-nums text-muted-foreground">{category.order}</span> },
      {
        key: "category",
        header: "Category",
        cell: (category) => (
          <div className="flex min-w-0 flex-col">
            <span className="block max-w-64 truncate font-medium">{category.name}</span>
            {category.description ? <span className="block max-w-64 truncate text-xs text-muted-foreground md:max-w-md">{category.description}</span> : null}
          </div>
        ),
      },
      {
        key: "slug",
        header: "Slug",
        className: "hidden sm:table-cell",
        cell: (category) => <code className="block max-w-48 truncate font-mono text-xs text-muted-foreground">{category.slug}</code>,
      },
      {
        key: "updated",
        header: "Updated",
        className: "hidden lg:table-cell",
        cell: (category) => (
          <time dateTime={category.updatedAt} title={formatDateTime(category.updatedAt)} className="text-muted-foreground">
            {formatRelative(category.updatedAt)}
          </time>
        ),
      },
      {
        key: "actions",
        header: "Actions",
        className: "w-28 text-right",
        cell: (category) => (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" aria-label={"Edit " + category.name} onClick={() => setEditor({ mode: "edit", category })}>
              <Pencil aria-hidden />
            </Button>
            <Button variant="ghost" size="icon" aria-label={"Delete " + category.name} onClick={() => setRemoving(category)}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  const filtered = state.q !== "";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading mb-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Categories</h2>
          <p className="text-sm text-muted-foreground">The platform categories sellers assign their products to. Lower order numbers are listed first.</p>
        </div>
        <Button onClick={() => setEditor({ mode: "create" })}>
          <Plus aria-hidden />
          New category
        </Button>
      </div>

      <div className="relative" role="search">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          aria-label="Search categories"
          placeholder="Search by name or slug"
          className="pl-9"
          value={search}
          maxLength={100}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {error && data ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/20 bg-destructive/8 px-5 py-4 text-sm text-foreground">
          <span>{error.message} The list shown may be out of date.</span>
          <Button variant="outline" size="sm" onClick={refetch}>
            Try again
          </Button>
        </div>
      ) : null}
      <DataTable
        label="Categories"
        columns={columns}
        rows={data?.docs ?? []}
        rowKey={(category) => category.id}
        loading={loading}
        error={error ? error.message : null}
        onRetry={refetch}
        emptyTitle={filtered ? "No categories match" : "No categories yet"}
        emptyHint={filtered ? "Try a different name or slug." : "Create the first category with the New category button."}
      />

      {data ? <TablePagination page={data.page} totalPages={data.totalPages} totalDocs={data.totalDocs} noun="category" plural="categories" disabled={loading} onPage={(page) => go({ ...state, page })} /> : null}

      {editor !== null ? (
        <CategoryFormDialog
          key={editor.mode === "edit" ? editor.category.id : "new"}
          editor={editor}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            refetch();
          }}
        />
      ) : null}
      {removing !== null ? (
        <DeleteCategoryDialog
          key={removing.id}
          category={removing}
          onClose={() => setRemoving(null)}
          onDeleted={() => {
            setRemoving(null);
            refetch();
          }}
        />
      ) : null}
    </div>
  );
}
