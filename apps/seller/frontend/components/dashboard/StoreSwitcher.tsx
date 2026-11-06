"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronsUpDown, LayoutGrid } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { StatusBadge } from "@/components/dashboard/shared/StatusBadge";
import { useDashboard } from "@/lib/dashboard-context";
import { parseStorePath, switchTargetHref } from "@/lib/store-routes";

/** Search only earns its space once the list is long (Blueprint §6.6: > ~7 stores). */
const SEARCH_THRESHOLD = 7;

function storeInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "S";
}

/**
 * Workspace switcher — lives in the sidebar header (Blueprint §6.6).
 *
 * Shows the active store, lists every store in `workspace.stores` with its
 * status badge, and links to the `/stores` portal. Selecting a store navigates
 * to the SAME section under that store (`/s/<new>/<section>`); detail routes
 * collapse to their list, since ids belong to the store being left.
 */
export function StoreSwitcher() {
  const { stores, activeStore } = useDashboard();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  function handleSelect(storeId: string) {
    setOpen(false);
    if (storeId === activeStore.id) return;
    const rest = parseStorePath(pathname)?.rest ?? "";
    router.push(switchTargetHref(storeId, rest));
  }

  function handleAllStores() {
    setOpen(false);
    router.push("/stores");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <SidebarMenuButton
            size="lg"
            aria-label="Switch store"
            className="data-[popup-open]:bg-sidebar-accent"
          />
        }
      >
        <div
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary font-heading text-base font-semibold text-primary-foreground"
          aria-hidden="true"
        >
          {storeInitial(activeStore.name)}
        </div>
        <div className="flex min-w-0 flex-1 flex-col text-left group-data-[collapsible=icon]:hidden">
          <span className="truncate text-sm font-medium">{activeStore.name}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{activeStore.slug}</span>
        </div>
        <ChevronsUpDown className="ml-auto size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
      </PopoverTrigger>

      <PopoverContent align="start" side="bottom" sideOffset={6} className="w-72 gap-0 p-0">
        <Command>
          {stores.length > SEARCH_THRESHOLD && <CommandInput placeholder="Search stores…" />}
          <CommandList>
            <CommandEmpty>No store found.</CommandEmpty>
            <CommandGroup heading="Your stores">
              {stores.map((s) => (
                <CommandItem
                  key={s.id}
                  value={`${s.name} ${s.slug} ${s.id}`}
                  data-checked={s.id === activeStore.id}
                  onSelect={() => handleSelect(s.id)}
                  className="gap-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{s.name}</span>
                    <span className="truncate font-mono text-xs text-muted-foreground">{s.slug}</span>
                  </div>
                  <StatusBadge status={s.status} className="shrink-0" />
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem value="__all-stores__" onSelect={handleAllStores}>
                <LayoutGrid />
                All stores
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
