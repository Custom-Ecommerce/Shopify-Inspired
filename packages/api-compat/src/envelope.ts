/** The list envelope the seller frontend reads. Field names match the Payload response it replaces. */
export interface ListEnvelope<T> {
  docs: T[];
  totalDocs: number;
  totalPages: number;
  page: number;
  limit: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface ListMeta {
  page: number;
  limit: number;
  totalDocs: number;
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(name + ' must be a positive integer');
  }
}

/** Builds the envelope from one page of docs and the paging metadata. Pure: no I/O. */
export function listEnvelope<T>(docs: readonly T[], meta: ListMeta): ListEnvelope<T> {
  assertPositiveInteger('page', meta.page);
  assertPositiveInteger('limit', meta.limit);
  if (!Number.isInteger(meta.totalDocs) || meta.totalDocs < 0) {
    throw new RangeError('totalDocs must be a non-negative integer');
  }
  const totalPages = meta.totalDocs === 0 ? 0 : Math.ceil(meta.totalDocs / meta.limit);
  return {
    docs: [...docs],
    totalDocs: meta.totalDocs,
    totalPages,
    page: meta.page,
    limit: meta.limit,
    hasNextPage: meta.page < totalPages,
    hasPrevPage: meta.page > 1,
  };
}
