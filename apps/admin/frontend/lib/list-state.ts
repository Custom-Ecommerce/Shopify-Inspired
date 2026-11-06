/** Shared readers for list state held in the URL. Anything unreadable falls back to the default. */

export const SEARCH_MAX = 100;

type Params = { get(name: string): string | null };

export function readPage(params: Params): number {
  const raw = params.get("page") ?? "";
  return /^\d{1,6}$/.test(raw) && Number(raw) >= 1 ? Number(raw) : 1;
}

export function readSearch(params: Params): string {
  return (params.get("q") ?? "").trim().slice(0, SEARCH_MAX);
}

export function readChoice<T extends string>(params: Params, name: string, allowed: readonly T[], fallback: T): T {
  const raw = params.get(name) ?? "";
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}
