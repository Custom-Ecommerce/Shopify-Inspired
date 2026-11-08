"use client";

import type { ListEnvelope as PayloadFindResponse } from "@markaz/api-compat";
import type { Category as CategoryDoc } from "@markaz/contracts";
import { useState } from "react";
import { ArrowDown, ArrowUp, FolderTree } from "lucide-react";
import { toast } from "sonner";

import { useDashboardFetch } from "@/lib/hooks/use-dashboard-fetch";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import {
  CATEGORY_DESCRIPTION_MAX,
  CATEGORY_NAME_MAX,
  CATEGORY_SLUG_MAX,
  categorySlugError,
  planCategoryMove,
} from "@/lib/categories";
import { DataTable } from "@/components/dashboard/shared/DataTable";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";
import { ErrorState } from "@/components/dashboard/shared/ErrorState";
import { LoadingState } from "@/components/dashboard/shared/LoadingState";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { RefreshButton } from "@/components/dashboard/shared/RefreshButton";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

/** The backend caps a page at 200. Reordering works on this one page. */
const LIST_URL = "/api/proxy/categories?limit=200";

const EMPTY_FORM = { name: "", slug: "", description: "" };

type FormState = typeof EMPTY_FORM;

/** The server's message, as the proxy normalises every failure to `{ error, code }`. */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  const data: unknown = await res.json().catch(() => null);
  if (typeof data === "object" && data !== null && "error" in data && typeof data.error === "string") return data.error;
  return fallback;
}

export default function DashboardCategoriesPage() {
  const storeFetch = useStoreFetch();
  const { data, loading, error: fetchError, refetch } = useDashboardFetch<PayloadFindResponse<CategoryDoc>>(LIST_URL);
  const categories = data?.docs ?? [];

  const [editing, setEditing] = useState<CategoryDoc | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleting, setDeleting] = useState<CategoryDoc | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [moving, setMoving] = useState(false);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(category: CategoryDoc) {
    setEditing(category);
    setForm({ name: category.name, slug: category.slug, description: category.description ?? "" });
    setFormError(null);
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const slugProblem = categorySlugError(form.slug);
    if (slugProblem) {
      setFormError(slugProblem);
      return;
    }
    if (editing && form.slug.trim() === "") {
      setFormError("Enter a slug.");
      return;
    }

    setSaving(true);
    setFormError(null);
    const slug = form.slug.trim();
    const payload = {
      name: form.name.trim(),
      ...(slug ? { slug } : {}),
      description: form.description.trim() || null,
    };
    try {
      const res = await storeFetch(editing ? `/api/proxy/categories/${editing.id}` : "/api/proxy/categories", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setFormError(await errorMessage(res, "Could not save this category."));
        return;
      }
      setShowForm(false);
      toast.success(editing ? "Category updated." : "Category created.");
      refetch();
    } catch {
      setFormError("Could not reach the backend. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleMove(index: number, direction: -1 | 1) {
    const changes = planCategoryMove(categories, index, direction);
    if (changes.length === 0) return;

    setMoving(true);
    try {
      const results = await Promise.all(
        changes.map((change) =>
          storeFetch(`/api/proxy/categories/${change.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ order: change.order }),
          }),
        ),
      );
      if (results.some((res) => !res.ok)) toast.error("Some categories could not be moved. Showing the saved order.");
    } catch {
      toast.error("Could not reach the backend. Showing the saved order.");
    } finally {
      setMoving(false);
      refetch();
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const res = await storeFetch(`/api/proxy/categories/${deleting.id}`, { method: "DELETE" });
      if (!res.ok) {
        setDeleteError(await errorMessage(res, "Could not delete this category."));
        return;
      }
      setDeleting(null);
      toast.success("Category deleted.");
      refetch();
    } catch {
      setDeleteError("Could not reach the backend. Please try again.");
    } finally {
      setDeleteBusy(false);
    }
  }

  const columns = [
    {
      header: "Order",
      className: "w-24",
      render: (c: CategoryDoc) => {
        const index = categories.findIndex((row) => row.id === c.id);
        return (
          <div className="flex items-center gap-1">
            <Button
              variant="clay-soft"
              size="sm"
              className="h-7 w-7 p-0"
              aria-label={`Move ${c.name} up`}
              disabled={moving || index === 0}
              onClick={() => handleMove(index, -1)}
            >
              <ArrowUp className="size-3.5" aria-hidden="true" />
            </Button>
            <Button
              variant="clay-soft"
              size="sm"
              className="h-7 w-7 p-0"
              aria-label={`Move ${c.name} down`}
              disabled={moving || index === categories.length - 1}
              onClick={() => handleMove(index, 1)}
            >
              <ArrowDown className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        );
      },
    },
    {
      header: "Name",
      className: "font-medium",
      render: (c: CategoryDoc) => (
        <span className="inline-flex items-center gap-2">
          {c.name}
          {c.isDemo ? <Badge variant="secondary">Demo</Badge> : null}
        </span>
      ),
    },
    { header: "Slug", accessorKey: "slug" as keyof CategoryDoc, className: "font-mono text-xs" },
    {
      header: "Description",
      render: (c: CategoryDoc) => <span className="line-clamp-1 text-muted-foreground">{c.description || "—"}</span>,
    },
    {
      header: "",
      className: "w-32 text-right",
      render: (c: CategoryDoc) => (
        <div className="flex items-center justify-end gap-3">
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => openEdit(c)}>
            Edit
          </Button>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs text-destructive"
            onClick={() => {
              setDeleteError(null);
              setDeleting(c);
            }}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 sm:p-8">
      <PageHeader title="Categories" description="Group your products. Shoppers only see categories that hold a published product.">
        <div className="flex gap-2">
          <Button variant="clay" onClick={openCreate}>New Category</Button>
          <RefreshButton />
        </div>
      </PageHeader>

      {loading ? (
        <LoadingState />
      ) : fetchError ? (
        <ErrorState message={fetchError} onRetry={refetch} />
      ) : categories.length === 0 ? (
        <EmptyState
          title="No categories yet"
          description="Every product needs a category, so create one first."
          icon={<FolderTree className="size-7" strokeWidth={1.5} />}
          action={<Button variant="clay" onClick={openCreate}>Create a category</Button>}
        />
      ) : (
        <SectionCard noPadding>
          <DataTable data={categories} columns={columns} keyExtractor={(c) => c.id} />
        </SectionCard>
      )}

      <Sheet open={showForm} onOpenChange={setShowForm}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{editing ? "Edit Category" : "New Category"}</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6">
            <div>
              <Label htmlFor="category-name" className="mb-1">Name</Label>
              <Input
                id="category-name"
                value={form.name}
                maxLength={CATEGORY_NAME_MAX}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label htmlFor="category-slug" className="mb-1">Slug</Label>
              <Input
                id="category-slug"
                value={form.slug}
                maxLength={CATEGORY_SLUG_MAX}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                placeholder={editing ? undefined : "Made from the name if left empty"}
                className="font-mono"
              />
            </div>
            <div>
              <Label htmlFor="category-description" className="mb-1">Description</Label>
              <Textarea
                id="category-description"
                value={form.description}
                maxLength={CATEGORY_DESCRIPTION_MAX}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={4}
              />
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <SheetFooter className="px-0">
              <Button type="submit" variant="clay" disabled={saving}>
                {saving ? "Saving…" : editing ? "Save changes" : "Create category"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete category?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <span className="font-medium text-foreground">{deleting?.name}</span>. A category that still holds products
              cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p className="px-1 text-xs text-destructive">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete} disabled={deleteBusy}>
              {deleteBusy ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
