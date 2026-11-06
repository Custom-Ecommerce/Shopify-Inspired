/** The data layer's "Draft" or "Sample product" tag, shown only in a seller's preview. Stiletto only draws it. */
export function PreviewLabel({ label, className = "" }: { label: string | null | undefined; className?: string }) {
  if (!label) return null;
  return (
    <span
      className={`inline-block rounded-md bg-(--surface-inverse) px-2 py-1 text-xs font-medium text-[var(--text-inverse)] ${className}`}
    >
      {label}
    </span>
  );
}
