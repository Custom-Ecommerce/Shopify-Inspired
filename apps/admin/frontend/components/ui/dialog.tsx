"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** While true the dialog cannot be dismissed, so a write in flight is not abandoned. */
  busy?: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * A modal built on the native dialog element: focus is trapped, Escape closes it, and the page behind is inert, with
 * no extra dependency. Colours come only from the tokens in globals.css.
 */
export function Dialog({ open, onClose, title, description, busy = false, className, children }: DialogProps) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const pressedBackdrop = React.useRef(false);
  const titleId = React.useId();
  const descriptionId = React.useId();

  React.useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onMouseDown={(event) => {
        pressedBackdrop.current = event.target === ref.current;
      }}
      onClick={(event) => {
        if (pressedBackdrop.current && event.target === ref.current && !busy) onClose();
        pressedBackdrop.current = false;
      }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-border bg-popover p-0 text-popover-foreground shadow-lg backdrop:bg-foreground/20 backdrop:backdrop-blur-xs",
        className,
      )}
    >
      <div className="flex flex-col gap-5 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h2 id={titleId} className="font-heading text-lg font-semibold tracking-tight text-foreground">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="text-sm text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose} disabled={busy}>
            <X aria-hidden />
          </Button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
