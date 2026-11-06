import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Inbox, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Applied to the header and every cell, for example "hidden md:table-cell". */
  className?: string;
}

export interface DataTableProps<T> {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  emptyTitle: string;
  emptyHint?: string;
  label: string;
}

const SKELETON_ROWS = 6;

/** The list table every console list uses: loading skeleton, error with retry, empty state, then the rows. */
export function DataTable<T>({ columns, rows, rowKey, loading, error, onRetry, emptyTitle, emptyHint, label }: DataTableProps<T>) {
  if (error !== null && rows.length === 0) {
    return (
      <Card role="alert" className="flex flex-col items-center gap-4 border-destructive/20 bg-destructive/8 px-6 py-12 text-center">
        <span className="flex size-12 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/10">
          <TriangleAlert className="size-6 text-destructive" aria-hidden />
        </span>
        <p className="max-w-sm text-sm font-medium text-foreground">{error}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </Card>
    );
  }

  if (!loading && rows.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-4 bg-muted/30 px-4 py-16 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground">
          <Inbox className="size-7" strokeWidth={1.5} aria-hidden />
        </span>
        <div className="max-w-xs">
          <p className="font-heading text-lg font-semibold text-foreground">{emptyTitle}</p>
          {emptyHint ? <p className="mt-1 text-sm text-muted-foreground">{emptyHint}</p> : null}
        </div>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <Table aria-label={label} aria-busy={loading}>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            {columns.map((column) => (
              <TableHead key={column.key} className={column.className}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody className={cn(loading && rows.length > 0 && "opacity-60")}>
          {rows.length === 0
            ? Array.from({ length: SKELETON_ROWS }, (_, index) => (
                <TableRow key={index} className="h-14 hover:bg-transparent">
                  {columns.map((column) => (
                    <TableCell key={column.key} className={column.className}>
                      <Skeleton className="h-4 w-full max-w-40" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : rows.map((row) => (
                <TableRow key={rowKey(row)} className="h-14">
                  {columns.map((column) => (
                    <TableCell key={column.key} className={column.className}>
                      {column.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
        </TableBody>
      </Table>
    </Card>
  );
}

export interface TablePaginationProps {
  page: number;
  totalPages: number;
  totalDocs: number;
  noun: string;
  /** The plural of noun when it is not noun plus s, for example entries. */
  plural?: string;
  disabled: boolean;
  onPage: (page: number) => void;
}

export function TablePagination({ page, totalPages, totalDocs, noun, plural, disabled, onPage }: TablePaginationProps) {
  const nouns = plural ?? noun + "s";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted-foreground" aria-live="polite">
        {totalDocs === 0 ? "No " + nouns : totalDocs + (totalDocs === 1 ? " " + noun : " " + nouns)}
        {totalPages > 1 ? " - page " + page + " of " + totalPages : ""}
      </p>
      {totalPages > 1 ? (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeft aria-hidden />
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={disabled || page >= totalPages} onClick={() => onPage(page + 1)}>
            Next
            <ChevronRight aria-hidden />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
