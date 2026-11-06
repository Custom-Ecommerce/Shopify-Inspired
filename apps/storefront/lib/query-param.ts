/**
 * The first value of a query-string parameter, trimmed and capped at maxLength. A repeated parameter keeps its first
 * value, so a crafted URL cannot pass an array where a page expects a string.
 */
export function queryParam(value: string | string[] | undefined, maxLength: number): string {
  const first = Array.isArray(value) ? value[0] : value;
  return (first ?? "").trim().slice(0, maxLength);
}
