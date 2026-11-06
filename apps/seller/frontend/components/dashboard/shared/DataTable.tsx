import type { ReactNode } from "react";
import { Surface } from "@/components/shared/Surface";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";

/** Column definition — identical API to the old DataTable for backward compat. */
export interface ColumnDef<T> {
  header: ReactNode;
  accessorKey?: keyof T;
  render?: (row: T) => ReactNode;
  /** Extra classes applied to both <th> and <td> */
  className?: string;
}

interface FilterChip {
  label: string;
  value: string;
  count?: number;
}

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  keyExtractor: (row: T) => string;
  className?: string;
  /** Show the search toolbar. Pass `searchValue` and `onSearchChange` together. */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  /** Filter chip toggles (outlined pill buttons). */
  filterChips?: FilterChip[];
  activeFilter?: string;
  onFilterChange?: (value: string) => void;
  /** Right-aligned toolbar slot — primary action or column toggle. */
  toolbarAction?: ReactNode;
  /** Empty state: shown when data.length === 0 */
  emptyState?: ReactNode;
}

/**
 * DataTable — blueprint §5.5.
 *
 * Container: Surface level 2, rounded-2xl, overflow-hidden.
 * Toolbar: search input, outlined filter chips, action slot.
 * Header: bg-muted/40, text-xs uppercase tracking-wider, sticky within scroll.
 * Rows: h-14, hover bg-accent/50, hairline border-border.
 *
 * API is 100% backward-compatible: (data, columns, keyExtractor, className)
 * are identical to the old DataTable. Everything else is additive.
 */
export function DataTable<T>({
  data,
  columns,
  keyExtractor,
  className,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search…",
  filterChips,
  activeFilter,
  onFilterChange,
  toolbarAction,
  emptyState,
}: DataTableProps<T>) {
  const hasToolbar =
    onSearchChange || (filterChips && filterChips.length > 0) || toolbarAction;

  return (
    <Surface
      variant="clay"
      level={2}
      radius="2xl"
      className={cn("overflow-hidden", className)}
    >
      {/* ── Toolbar ────────────────────────────────────────────────────── */}
      {hasToolbar && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-3 sm:px-5">
          {/* Search input (blueprint §5.5) */}
          {onSearchChange && (
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="h-8 pl-9 text-sm placeholder:text-muted-foreground"
              />
            </div>
          )}

          {/* Filter chips: outlined toggle pills */}
          {filterChips && filterChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {filterChips.map((chip) => (
                <Button
                  key={chip.value}
                  variant={activeFilter === chip.value ? "default" : "clay-soft"}
                  size="sm"
                  className="h-8 rounded-full px-3 text-xs"
                  onClick={() => onFilterChange?.(chip.value)}
                >
                  {chip.label}
                  {chip.count !== undefined && (
                    <span className="ml-1 rounded-full bg-background/40 px-1.5 py-0.5 text-[10px] tabular-nums">
                      {chip.count}
                    </span>
                  )}
                </Button>
              ))}
            </div>
          )}

          {/* Right-aligned action */}
          {toolbarAction && (
            <div className="ml-auto flex items-center gap-2">
              {toolbarAction}
            </div>
          )}
        </div>
      )}

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            {/* Sticky header within scroll container */}
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              {columns.map((col, i) => (
                <TableHead
                  key={i}
                  className={cn(
                    // blueprint §5.5: text-xs uppercase tracking-wider, NOT font-mono
                    "h-11 text-xs font-semibold uppercase tracking-wider text-muted-foreground",
                    col.className
                  )}
                >
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length === 0 ? (
              emptyState ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columns.length} className="p-0">
                    {emptyState}
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={columns.length}
                    className="py-16 text-center text-sm text-muted-foreground"
                  >
                    No data to display.
                  </TableCell>
                </TableRow>
              )
            ) : (
              data.map((row) => (
                <TableRow
                  key={keyExtractor(row)}
                  className="h-14 border-border transition-colors hover:bg-accent/50"
                >
                  {columns.map((col, i) => (
                    <TableCell key={i} className={cn("text-sm", col.className)}>
                      {col.render
                        ? col.render(row)
                        : col.accessorKey
                        ? String(row[col.accessorKey] ?? "—")
                        : null}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Surface>
  );
}
