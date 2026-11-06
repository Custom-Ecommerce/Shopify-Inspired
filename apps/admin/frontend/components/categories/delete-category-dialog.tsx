"use client";

import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { deleteCategory } from "@/lib/api/client";
import type { AdminCategory } from "@/lib/contracts";
import { useAdminMutation } from "@/lib/hooks/use-admin-mutation";

/** Confirms and performs a delete. Mount it to open it. A category that is already gone is reported, not hidden. */
export function DeleteCategoryDialog({ category, onClose, onDeleted }: { category: AdminCategory; onClose: () => void; onDeleted: () => void }) {
  const mutation = useAdminMutation((id: string) => deleteCategory(id));

  async function confirm() {
    const result = await mutation.run(category.id);
    if (result === null) return;
    toast.success("Category deleted", { description: category.name });
    onDeleted();
  }

  return (
    <Dialog open onClose={onClose} busy={mutation.pending} title="Delete this category" description="This removes the category from the platform catalogue. The change is recorded in the audit log.">
      <p className="text-sm">
        <span className="font-medium">{category.name}</span> <code className="font-mono text-xs text-muted-foreground">{category.slug}</code>
      </p>
      {mutation.error ? (
        <p role="alert" className="text-sm text-destructive">
          {mutation.error.message}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={mutation.pending}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={confirm} disabled={mutation.pending}>
          {mutation.pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Delete category
        </Button>
      </div>
    </Dialog>
  );
}
