import type { ReactNode } from "react";

export interface FieldItem {
  label: string;
  value: ReactNode;
}

/** Label and value pairs for a detail card. */
export function FieldList({ items }: { items: FieldItem[] }) {
  return (
    <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 break-words text-sm text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
