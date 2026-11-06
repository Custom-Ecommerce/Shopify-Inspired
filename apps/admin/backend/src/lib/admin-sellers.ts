import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_PAGE,
  MAX_SEARCH_LENGTH,
  escapeRegex,
  idOf,
  isObjectId,
  readInteger,
  toIso,
  type Doc,
  type Issue,
  type StoreStatus,
} from '@/lib/admin-stores';

/** Pure helpers for the admin seller list: query parsing, the Mongo filter, and the wire shape. No I/O. */

/** How many of a seller's stores the list previews. The full count is always reported. */
export const STORE_PREVIEW = 3;

export interface SellerListQuery {
  page: number;
  limit: number;
  q: string | null;
}

export type ParsedSellerQuery = { ok: true; query: SellerListQuery } | { ok: false; issues: Issue[] };

export function parseSellerListQuery(params: URLSearchParams): ParsedSellerQuery {
  const issues: Issue[] = [];
  const page = readInteger(params.get('page'), 1, 1, MAX_PAGE);
  if (page === null) issues.push({ path: 'page', message: 'must be a whole number from 1 to ' + MAX_PAGE });
  const limit = readInteger(params.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);
  if (limit === null) issues.push({ path: 'limit', message: 'must be a whole number from 1 to ' + MAX_LIMIT });
  const rawQ = (params.get('q') ?? '').trim();
  if (rawQ.length > MAX_SEARCH_LENGTH) issues.push({ path: 'q', message: 'must be at most ' + MAX_SEARCH_LENGTH + ' characters' });
  if (issues.length > 0 || page === null || limit === null) return { ok: false, issues };
  return { ok: true, query: { page, limit, q: rawQ === '' ? null : rawQ } };
}

/** Seller accounts only. The search text is escaped, so it is matched literally, never as a pattern. */
export function buildSellerFilter(query: SellerListQuery): Doc {
  const filter: Doc = { role: 'seller' };
  if (query.q !== null) {
    const pattern = { $regex: escapeRegex(query.q), $options: 'i' };
    const or: Doc[] = [{ name: pattern }, { email: pattern }];
    if (isObjectId(query.q)) or.push({ _id: query.q });
    filter.$or = or;
  }
  return filter;
}

/** Stores grouped by the id of their owner, in the order given. */
export function groupStoresByOwner(stores: Doc[]): Map<string, Doc[]> {
  const grouped = new Map<string, Doc[]>();
  for (const store of stores) {
    const owner = idOf(store.owner);
    if (owner === null) continue;
    const list = grouped.get(owner);
    if (list) list.push(store);
    else grouped.set(owner, [store]);
  }
  return grouped;
}

export function toSellerItem(doc: Doc, stores: Doc[]) {
  return {
    id: String(doc._id),
    name: typeof doc.name === 'string' ? doc.name : '',
    email: typeof doc.email === 'string' ? doc.email : '',
    stores: stores.slice(0, STORE_PREVIEW).map((store) => ({
      id: String(store._id),
      name: typeof store.name === 'string' ? store.name : '',
      status: store.status as StoreStatus,
    })),
    storeCount: stores.length,
    createdAt: toIso(doc.createdAt) ?? new Date(0).toISOString(),
  };
}
