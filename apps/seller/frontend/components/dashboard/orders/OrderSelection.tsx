"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { storeHref } from "@/lib/store-routes";

/**
 * Selection on the orders list, for bulk printing (EP-02 OB-5b). The list itself stays server-rendered; these are small
 * client leaves inside it. The provider is keyed on the filters by the page, so changing a filter or a page starts empty.
 */

const MAX_SELECTED = 50;

interface SelectionValue {
  storeId: string;
  selected: string[];
  atLimit: boolean;
  toggle: (id: string) => void;
  setPage: (ids: readonly string[], on: boolean) => void;
  clear: () => void;
}

const SelectionContext = createContext<SelectionValue | null>(null);

function useSelection(): SelectionValue {
  const value = useContext(SelectionContext);
  if (!value) throw new Error("Order selection controls must be inside OrderSelectionProvider.");
  return value;
}

export function OrderSelectionProvider({ storeId, children }: { storeId: string; children: ReactNode }) {
  const [selected, setSelected] = useState<string[]>([]);

  const value = useMemo<SelectionValue>(
    () => ({
      storeId,
      selected,
      atLimit: selected.length >= MAX_SELECTED,
      toggle: (id) =>
        setSelected((current) => {
          if (current.includes(id)) return current.filter((entry) => entry !== id);
          return current.length >= MAX_SELECTED ? current : [...current, id];
        }),
      setPage: (ids, on) =>
        setSelected((current) => {
          if (!on) return current.filter((entry) => !ids.includes(entry));
          const added = ids.filter((id) => !current.includes(id));
          return [...current, ...added].slice(0, MAX_SELECTED);
        }),
      clear: () => setSelected([]),
    }),
    [storeId, selected],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

const CHECK_TARGET = "flex size-11 shrink-0 cursor-pointer items-center justify-center";
const CHECK_BOX = "size-4 cursor-pointer accent-primary disabled:cursor-not-allowed";

export function OrderCheckbox({ id, label }: { id: string; label: string }) {
  const { selected, atLimit, toggle } = useSelection();
  const checked = selected.includes(id);
  return (
    <label className={CHECK_TARGET}>
      <input type="checkbox" className={CHECK_BOX} checked={checked} disabled={!checked && atLimit} onChange={() => toggle(id)} aria-label={label} />
    </label>
  );
}

export function SelectPageCheckbox({ ids, showText = false }: { ids: readonly string[]; showText?: boolean }) {
  const { selected, setPage } = useSelection();
  const count = ids.filter((id) => selected.includes(id)).length;
  const all = ids.length > 0 && count === ids.length;
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (box.current) box.current.indeterminate = count > 0 && !all;
  }, [count, all]);

  return (
    <label className={showText ? "flex h-11 cursor-pointer items-center gap-2 text-sm" : CHECK_TARGET}>
      <span className={showText ? "flex size-11 items-center justify-center" : "contents"}>
        <input ref={box} type="checkbox" className={CHECK_BOX} checked={all} onChange={() => setPage(ids, !all)} aria-label="Select all orders on this page" />
      </span>
      {showText ? "Select page" : null}
    </label>
  );
}

export function OrderSelectionBar() {
  const { storeId, selected, atLimit, clear } = useSelection();
  if (selected.length === 0) return null;

  const printHref = (mode: "label" | "slip"): string => storeHref(storeId, `/orders/print?ids=${selected.join(",")}&mode=${mode}`);
  const link = (mode: "label" | "slip", text: string) => (
    <Button variant="clay-soft" className="h-11 flex-1 sm:h-9 sm:flex-none" render={<a href={printHref(mode)} target="_blank" rel="noopener" />}>
      {text}
    </Button>
  );

  return (
    <div className="sticky bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-background p-2 shadow-md" role="region" aria-label="Selected orders">
      <span className="w-full text-sm font-medium sm:w-auto">{selected.length} selected</span>
      {link("label", "Print labels")}
      {link("slip", "Print slips")}
      <Button variant="ghost" className="h-11 flex-1 sm:h-9 sm:flex-none" onClick={clear}>
        Clear
      </Button>
      {atLimit ? <span className="w-full text-xs text-muted-foreground sm:w-auto">You can print up to {MAX_SELECTED} orders at once.</span> : null}
    </div>
  );
}
