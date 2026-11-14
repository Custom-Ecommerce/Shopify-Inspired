import type { AuthTokenModelPort } from '../../src';

// A fake AuthToken model: findOneAndUpdate matches and writes in one step, as MongoDB does for one document.

type Row = Record<string, any>;

function cond(actual: unknown, expected: unknown): boolean {
  if (expected !== null && typeof expected === 'object' && !(expected instanceof Date)) {
    return Object.entries(expected as Row).every(([op, value]) => {
      if (op === '$in') return (value as unknown[]).includes(actual);
      if (op === '$gt') return actual instanceof Date && actual.getTime() > (value as Date).getTime();
      throw new Error('unsupported ' + op);
    });
  }
  if (expected === null) return actual === null || actual === undefined;
  return String(actual) === String(expected);
}
const matches = (row: Row, filter: Row) => Object.entries(filter).every(([k, v]) => cond(row[k], v));

export function fakeTokens() {
  const rows: Row[] = [];
  const model: AuthTokenModelPort = {
    async create(doc) {
      if (rows.some((r) => r.tokenHash === doc.tokenHash)) throw Object.assign(new Error('dup'), { code: 11000 });
      rows.push({ ...doc });
      return doc;
    },
    async updateMany(filter, update) {
      for (const row of rows.filter((r) => matches(r, filter))) Object.assign(row, (update as Row).$set);
      return {};
    },
    findOneAndUpdate(filter, update) {
      return {
        lean: async () => {
          const row = rows.find((r) => matches(r, filter));
          if (!row) return null;
          Object.assign(row, (update as Row).$set);
          return { ...row };
        },
      };
    },
  };
  return { rows, model };
}

