"use client";

import { useState } from "react";
import { Eye } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { refusalMessage } from "@/lib/product-actions";

/**
 * "Preview store": asks for a fresh link on every click (D-019) and opens it in a new tab. The tab is opened before the
 * request, because a browser blocks a window opened after an await. The link is never kept here.
 */
export function PreviewStoreButton() {
  const storeFetch = useStoreFetch();
  const [opening, setOpening] = useState(false);

  async function openPreview() {
    const tab = window.open("", "_blank");
    if (tab === null) {
      toast.error("Your browser blocked the preview tab. Allow pop-ups for this site and try again.");
      return;
    }
    tab.opener = null;
    setOpening(true);
    try {
      const res = await storeFetch("/api/dashboard/preview-token", { method: "POST" });
      const body: unknown = await res.json().catch(() => null);
      const url = (body as { url?: unknown } | null)?.url;
      if (!res.ok || typeof url !== "string") {
        tab.close();
        toast.error(refusalMessage(body, "Could not open the preview."));
        return;
      }
      tab.location.href = url;
    } catch {
      tab.close();
      toast.error("Could not reach the backend. Please try again.");
    } finally {
      setOpening(false);
    }
  }

  return (
    <>
      <div className="group-data-[collapsible=icon]:hidden">
        <Button variant="clay-soft" size="sm" className="w-full justify-center" disabled={opening} onClick={openPreview}>
          Preview store <Eye className="size-3" />
        </Button>
      </div>
      <div className="hidden group-data-[collapsible=icon]:flex items-center justify-center">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                disabled={opening}
                onClick={openPreview}
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              />
            }
          >
            <Eye className="size-4" />
            <span className="sr-only">Preview store</span>
          </TooltipTrigger>
          <TooltipContent side="right">Preview store</TooltipContent>
        </Tooltip>
      </div>
    </>
  );
}
