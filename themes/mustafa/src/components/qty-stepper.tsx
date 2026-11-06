"use client";

import { MAX_LINE_QTY } from "@markaz/storefront-data";
import { MinusIcon, PlusIcon } from "./ui/icons";

export interface QtyStepperProps {
  /** The product's name. Each button names the product, so a screen reader says which line it changes. */
  label: string;
  qty: number;
  onChange: (qty: number) => void;
  max?: number;
}

const STEP_BUTTON =
  "inline-flex size-11 shrink-0 items-center justify-center text-(color:--mu-fg) transition-colors hover:bg-(--mu-surface-muted) active:bg-(--mu-border) disabled:pointer-events-none disabled:opacity-40 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-(color:--mu-focus)";

/**
 * A quantity with minus and plus buttons. Minus stops at one: removing a line is the Remove button's job, so a stray
 * tap cannot delete a line. Plus stops at the cap.
 */
export function QtyStepper({ label, qty, onChange, max = MAX_LINE_QTY }: QtyStepperProps) {
  return (
    <div
      role="group"
      aria-label={"Quantity, " + label}
      className="inline-flex items-center overflow-hidden rounded-(--mu-radius) border border-(--mu-border) bg-(--mu-surface) shadow-(--mu-shadow-sm)"
    >
      <button
        type="button"
        aria-label={"Decrease quantity of " + label}
        disabled={qty <= 1}
        onClick={() => onChange(qty - 1)}
        className={STEP_BUTTON}
      >
        <MinusIcon />
      </button>
      <span aria-live="polite" className="min-w-10 px-2 text-center text-sm font-semibold tabular-nums">
        {qty}
      </span>
      <button
        type="button"
        aria-label={"Increase quantity of " + label}
        disabled={qty >= max}
        onClick={() => onChange(qty + 1)}
        className={STEP_BUTTON}
      >
        <PlusIcon />
      </button>
    </div>
  );
}
