"use client";

import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { refusalMessage } from "@/lib/product-actions";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
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

/** demo: gone at once. trash: recoverable for a year. permanent: from trash, gone for good. */
export type DeleteMode = "demo" | "trash" | "permanent";

const COPY: Record<DeleteMode, { label: string; title: string; action: string; after: string }> = {
  demo: {
    label: "Delete",
    title: "Delete sample product?",
    action: "This will permanently delete",
    after: "This can't be undone.",
  },
  trash: {
    label: "Delete",
    title: "Move to trash?",
    action: "This takes off your store and moves to trash:",
    after: "You can restore it from Trash for 365 days.",
  },
  permanent: {
    label: "Delete forever",
    title: "Delete forever?",
    action: "This will permanently delete",
    after: "This can't be undone. Its reviews are archived, and past orders keep their details.",
  },
};

export function DeleteProductButton({
  productId,
  productTitle,
  mode,
}: {
  productId: string;
  productTitle: string;
  mode: DeleteMode;
}) {
  const storeFetch = useStoreFetch();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[mode];

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const query = mode === "permanent" ? "?permanent=true" : "";
      const res = await storeFetch(`/api/dashboard/products/${productId}${query}`, { method: "DELETE" });
      if (!res.ok) {
        setError(refusalMessage(await res.json().catch(() => null), "Could not delete this product."));
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not reach the backend. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs text-destructive"
        onClick={() => setOpen(true)}
      >
        {copy.label}
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {copy.action}{" "}
            <span className="font-medium text-foreground">{productTitle}</span>.{" "}
            {copy.after}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="px-1 text-xs text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : copy.label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
