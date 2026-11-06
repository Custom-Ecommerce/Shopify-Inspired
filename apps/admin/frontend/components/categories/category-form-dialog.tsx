"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createCategory, updateCategory } from "@/lib/api/client";
import {
  EMPTY_CATEGORY_FORM,
  formFromCategory,
  issuesToErrors,
  slugify,
  toCreateRequest,
  toUpdateRequest,
  validateCategoryForm,
  type CategoryFormErrors,
  type CategoryFormField,
  type CategoryFormValues,
} from "@/lib/categories";
import {
  ADMIN_CATEGORY_DESCRIPTION_MAX,
  ADMIN_CATEGORY_NAME_MAX,
  ADMIN_CATEGORY_ORDER_MAX,
  ADMIN_CATEGORY_SLUG_MAX,
  type AdminCategory,
  type AdminCategoryCreateRequest,
  type AdminCategoryUpdateRequest,
} from "@/lib/contracts";
import { useAdminMutation } from "@/lib/hooks/use-admin-mutation";

export type CategoryEditor = { mode: "create" } | { mode: "edit"; category: AdminCategory };

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

/**
 * Create or edit one category. Mount it to open it: the form starts from the category (or empty), the slug follows
 * the name until the operator edits the slug, and the rules are the backend's. Server messages land on the field.
 */
export function CategoryFormDialog({ editor, onClose, onSaved }: { editor: CategoryEditor; onClose: () => void; onSaved: () => void }) {
  const editing = editor.mode === "edit" ? editor.category : null;
  const [values, setValues] = useState<CategoryFormValues>(editing ? formFromCategory(editing) : EMPTY_CATEGORY_FORM);
  const [slugTouched, setSlugTouched] = useState(editing !== null);
  const [errors, setErrors] = useState<CategoryFormErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const mutation = useAdminMutation((input: AdminCategoryCreateRequest | AdminCategoryUpdateRequest) =>
    editing ? updateCategory(editing.id, input) : createCategory(input as AdminCategoryCreateRequest),
  );

  const serverError = mutation.error;
  const serverFields: CategoryFormErrors = serverError ? issuesToErrors(serverError.issues) : {};
  if (serverError && serverError.status === 409 && /slug/i.test(serverError.message)) serverFields.slug = serverError.message;
  const shown: CategoryFormErrors = { ...serverFields };
  for (const [field, message] of Object.entries(errors)) {
    if (message) shown[field as CategoryFormField] = message;
  }
  const unmapped = serverError ? serverError.issues.filter((issue) => !["name", "slug", "order", "description"].includes(issue.path)).map((issue) => issue.message) : [];
  const generalParts = serverError ? (Object.keys(serverFields).length === 0 ? [serverError.message, ...unmapped] : unmapped) : [];
  const generalError = generalParts.length > 0 ? generalParts.join(" ") : null;

  function change(field: CategoryFormField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setNotice(null);
    mutation.reset();
  }

  function onName(value: string) {
    change("name", value);
    if (!slugTouched) setValues((current) => ({ ...current, name: value, slug: slugify(value) }));
  }

  function onSlug(value: string) {
    setSlugTouched(true);
    change("slug", value);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problems = validateCategoryForm(values, editing ? "edit" : "create");
    setErrors(problems);
    setNotice(null);
    if (Object.keys(problems).length > 0) return;

    let input: AdminCategoryCreateRequest | AdminCategoryUpdateRequest;
    if (editing) {
      input = toUpdateRequest(values, editing);
      if (Object.keys(input).length === 0) {
        setNotice("Nothing has changed.");
        return;
      }
    } else {
      input = toCreateRequest(values);
    }
    const saved = await mutation.run(input);
    if (saved === null) return;
    toast.success(editing ? "Category updated" : "Category created", { description: saved.name });
    onSaved();
  }

  const title = editing ? "Edit category" : "New category";
  return (
    <Dialog
      open
      onClose={onClose}
      busy={mutation.pending}
      title={title}
      description={editing ? "Changes are recorded in the audit log with your name." : "Sellers pick from these categories. Lower order numbers are listed first."}
    >
      <form onSubmit={onSubmit} noValidate aria-label={title} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="category-name">Name</Label>
          <Input
            id="category-name"
            autoFocus
            required
            maxLength={ADMIN_CATEGORY_NAME_MAX}
            value={values.name}
            aria-invalid={shown.name !== undefined}
            aria-describedby={shown.name !== undefined ? "category-name-error" : undefined}
            className="aria-[invalid=true]:border-destructive"
            onChange={(event) => onName(event.target.value)}
          />
          <FieldError id="category-name-error" message={shown.name} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="category-slug">Slug</Label>
          <Input
            id="category-slug"
            maxLength={ADMIN_CATEGORY_SLUG_MAX}
            value={values.slug}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={shown.slug !== undefined}
            aria-describedby={"category-slug-hint" + (shown.slug !== undefined ? " category-slug-error" : "")}
            className="font-mono aria-[invalid=true]:border-destructive"
            onChange={(event) => onSlug(event.target.value)}
          />
          <p id="category-slug-hint" className="text-xs text-muted-foreground">
            Lowercase letters, numbers, and hyphens. Left blank, it is made from the name.
          </p>
          <FieldError id="category-slug-error" message={shown.slug} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="category-order">Order</Label>
          <Input
            id="category-order"
            inputMode="numeric"
            maxLength={String(ADMIN_CATEGORY_ORDER_MAX).length}
            value={values.order}
            aria-invalid={shown.order !== undefined}
            aria-describedby={shown.order !== undefined ? "category-order-error" : undefined}
            className="w-32 tabular-nums aria-[invalid=true]:border-destructive"
            onChange={(event) => change("order", event.target.value)}
          />
          <FieldError id="category-order-error" message={shown.order} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="category-description">Description (optional)</Label>
          <Textarea
            id="category-description"
            rows={3}
            maxLength={ADMIN_CATEGORY_DESCRIPTION_MAX}
            value={values.description}
            aria-invalid={shown.description !== undefined}
            aria-describedby={shown.description !== undefined ? "category-description-error" : undefined}
            onChange={(event) => change("description", event.target.value)}
          />
          <FieldError id="category-description-error" message={shown.description} />
        </div>

        {notice !== null ? (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        ) : null}
        {generalError !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {generalError}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={mutation.pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.pending}>
            {mutation.pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {editing ? "Save changes" : "Create category"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
