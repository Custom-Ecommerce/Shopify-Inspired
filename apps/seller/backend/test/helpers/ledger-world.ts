import mongoose from 'mongoose';
import { AuditLog, CommissionEntry, NotificationOutbox, Order, Payout, Store, User } from '@/lib/services';

/**
 * Sprint 4 EP-05 (SB-7) test fixture: the commission ledger, payouts, stores and owners in memory, behind the Mongoose
 * model methods the payout and earnings code calls. No database. It understands exactly the filters and aggregation stages
 * those files use (and throws on anything else, so a new query shape is noticed): $match, $group with $sum, $sort, $skip,
 * $limit, $count and $facet; the filters equality, null, $in, $gte, $lt, $lte, $ne, $regex and $or.
 *
 * The partial unique index of payouts ({ store } while pending_settle) is emulated, and so is the settlement-only
 * update of the ledger. Every write yields once first, so two parallel calls really interleave.
 */

export const OWNER_A = '65a000000000000000000001';
export const OWNER_B = '65a000000000000000000002';
export const ADMIN = '65a000000000000000000003';
export const STORE_A = '65a000000000000000000011';
export const STORE_B = '65a000000000000000000012';
export const ORDER_1 = '65a0000000000000000a0001';
export const ORDER_2 = '65a0000000000000000a0002';
export const ORDER_3 = '65a0000000000000000a0003';
export const ACCOUNT_NUMBER = '03001234567';

export type Row = Record<string, any>;

const same = (a: unknown, b: unknown): boolean => String(a) === String(b);
const when = (value: unknown): number => new Date(value as Date).getTime();
const isOperatorObject = (cond: unknown): cond is Row =>
  typeof cond === 'object' && cond !== null && !(cond instanceof Date) && Object.keys(cond).length > 0 && Object.keys(cond).every((key) => key.startsWith('$'));

function matchValue(value: unknown, cond: unknown): boolean {
  if (cond === null) return value === null || value === undefined;
  if (!isOperatorObject(cond)) return same(value, cond);
  return Object.entries(cond).every(([op, arg]) => {
    switch (op) {
      case '$in':
        return (arg as unknown[]).some((candidate) => same(value, candidate));
      case '$ne':
        // $ne: null means "has a value": a missing field is null in MongoDB.
        return arg === null ? !(value === null || value === undefined) : !same(value, arg);
      case '$gte':
        return value !== null && value !== undefined && when(value) >= when(arg);
      case '$lt':
        return value !== null && value !== undefined && when(value) < when(arg);
      case '$lte':
        return value !== null && value !== undefined && when(value) <= when(arg);
      case '$regex':
        return new RegExp(String(arg), String(cond.$options ?? '')).test(String(value ?? ''));
      case '$options':
        return true;
      default:
        throw new Error('ledger-world: unsupported filter operator ' + op);
    }
  });
}

export function matchRow(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return (cond as Row[]).some((clause) => matchRow(row, clause));
    return matchValue(row[key], cond);
  });
}

const literal = (expr: unknown, doc: Row): unknown => (typeof expr === 'string' && expr.startsWith('$') ? doc[expr.slice(1)] : expr);

function evalExpr(expr: any, doc: Row): number {
  if (typeof expr === 'number') return expr;
  if (typeof expr === 'string') return Number(literal(expr, doc));
  if (expr.$cond) {
    const [test, yes, no] = expr.$cond;
    const [a, b] = test.$eq;
    return literal(a, doc) === literal(b, doc) ? evalExpr(yes, doc) : evalExpr(no, doc);
  }
  if (expr.$multiply) return (expr.$multiply as unknown[]).reduce<number>((product, part) => product * evalExpr(part, doc), 1);
  throw new Error('ledger-world: unsupported expression');
}

function runPipeline(source: Row[], pipeline: Row[]): Row[] {
  let rows = source.map((row) => ({ ...row }));
  for (const stage of pipeline) {
    if (stage.$match) rows = rows.filter((row) => matchRow(row, stage.$match));
    else if (stage.$group) {
      const { _id, ...sums } = stage.$group as Row;
      const groups = new Map<string, Row>();
      for (const row of rows) {
        const key = _id === null ? 'all' : String(row[String(_id).slice(1)]);
        let group = groups.get(key);
        if (!group) {
          group = { _id: _id === null ? null : row[String(_id).slice(1)] };
          for (const field of Object.keys(sums)) group[field] = 0;
          groups.set(key, group);
        }
        for (const [field, op] of Object.entries(sums)) group[field] += evalExpr((op as Row).$sum, row);
      }
      rows = [...groups.values()];
    } else if (stage.$sort) {
      const [[field, direction]] = Object.entries(stage.$sort as Row) as Array<[string, number]>;
      const rest = Object.entries(stage.$sort as Row).slice(1) as Array<[string, number]>;
      rows.sort((a, b) => {
        for (const [key, dir] of [[field, direction] as [string, number], ...rest]) {
          const x = String(a[key]);
          const y = String(b[key]);
          const delta = typeof a[key] === 'number' && typeof b[key] === 'number' ? a[key] - b[key] : x < y ? -1 : x > y ? 1 : 0;
          if (delta !== 0) return delta * dir;
        }
        return 0;
      });
    } else if (stage.$skip !== undefined) rows = rows.slice(stage.$skip);
    else if (stage.$limit !== undefined) rows = rows.slice(0, stage.$limit);
    else if (stage.$count) rows = rows.length === 0 ? [] : [{ [stage.$count]: rows.length }];
    else if (stage.$facet) {
      rows = [Object.fromEntries(Object.entries(stage.$facet as Row).map(([name, sub]) => [name, runPipeline(rows, sub as Row[])]))];
    } else throw new Error('ledger-world: unsupported stage ' + Object.keys(stage).join(','));
  }
  return rows;
}

interface Chain {
  select: () => Chain;
  sort: (spec: Row) => Chain;
  skip: (count: number) => Chain;
  limit: (count: number) => Chain;
  lean: () => Promise<any>;
}

function listChain(read: () => Row[]): Chain {
  let sortSpec: Row | null = null;
  let skipped = 0;
  let limited: number | null = null;
  const chain: Chain = {
    select: () => chain,
    sort: (spec) => {
      sortSpec = spec;
      return chain;
    },
    skip: (count) => {
      skipped = count;
      return chain;
    },
    limit: (count) => {
      limited = count;
      return chain;
    },
    lean: async () => {
      await Promise.resolve();
      let rows = read().map((row) => ({ ...row }));
      if (sortSpec) {
        const entries = Object.entries(sortSpec) as Array<[string, number]>;
        rows.sort((a, b) => {
          for (const [key, dir] of entries) {
            const x = a[key] instanceof Date ? when(a[key]) : String(a[key]);
            const y = b[key] instanceof Date ? when(b[key]) : String(b[key]);
            if (x < y) return -dir;
            if (x > y) return dir;
          }
          return 0;
        });
      }
      rows = rows.slice(skipped);
      if (limited !== null) rows = rows.slice(0, limited);
      return rows;
    },
  };
  return chain;
}

const oneChain = (read: () => Row | null): Chain => {
  const chain: Chain = { select: () => chain, sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => {
    await Promise.resolve();
    const row = read();
    return row === null ? null : { ...row };
  } };
  return chain;
};

export interface World {
  entries: Row[];
  payouts: Row[];
  stores: Record<string, Row>;
  users: Record<string, Row>;
  orders: Row[];
  audits: Row[];
  outbox: Row[];
  /** Page ids the order-number lookup was asked for, one list per call. */
  orderLookups: string[][];
  /** The claim stops (and throws) after this many entries, once: a request that died halfway. */
  claimCrashAfter: number | null;
  /** The claim only reaches this many entries and does not throw: the ledger moved under it. */
  claimLimit: number | null;
  /** The next change of a payout to paid throws once: a request that died before the last step. */
  crashBeforePaid: boolean;
  auditFails: boolean;
  entry: (overrides?: Row) => Row;
  restore: () => void;
}

let sequence = 0;
const nextId = (): string => new mongoose.Types.ObjectId().toHexString();

/** Installs the stubs. Call restore() in afterEach. */
export function installLedgerWorld(): World {
  const saved: Array<() => void> = [];
  const patch = (target: any, name: string, replacement: unknown): void => {
    const original = target[name];
    target[name] = replacement;
    saved.push(() => {
      target[name] = original;
    });
  };

  const world: World = {
    entries: [],
    payouts: [],
    stores: {
      [STORE_A]: {
        _id: STORE_A,
        name: 'Zara Lawn',
        slug: 'zara',
        owner: OWNER_A,
        payoutDetails: { method: 'jazzcash', accountTitle: 'Zara Khan', accountNumber: ACCOUNT_NUMBER, bankName: null },
      },
      [STORE_B]: { _id: STORE_B, name: 'Bilal Looms', slug: 'bilal', owner: OWNER_B, payoutDetails: undefined },
    },
    users: {
      [OWNER_A]: { _id: OWNER_A, role: 'seller', email: 'zara@example.com', emailVerifiedAt: new Date('2026-10-01T00:00:00Z'), notificationPrefs: {} },
      [OWNER_B]: { _id: OWNER_B, role: 'seller', email: 'bilal@example.com', emailVerifiedAt: null, notificationPrefs: {} },
      [ADMIN]: { _id: ADMIN, role: 'admin', email: 'admin@example.com', emailVerifiedAt: new Date('2026-10-01T00:00:00Z'), notificationPrefs: {} },
    },
    orders: [
      { _id: ORDER_1, orderId: 'ORD-AAAA1111', store: STORE_A },
      { _id: ORDER_2, orderId: 'ORD-BBBB2222', store: STORE_A },
      { _id: ORDER_3, orderId: 'ORD-CCCC3333', store: STORE_A },
    ],
    audits: [],
    outbox: [],
    orderLookups: [],
    claimCrashAfter: null,
    claimLimit: null,
    crashBeforePaid: false,
    auditFails: false,
    entry: (overrides = {}) => {
      sequence += 1;
      const row: Row = {
        _id: nextId(),
        store: STORE_A,
        order: ORDER_1,
        type: 'cod_commission',
        balanceEffect: -80,
        baseAmount: 2000,
        rate: 4,
        reversesType: null,
        settledAt: null,
        payoutId: null,
        createdAt: new Date(Date.UTC(2026, 10, 1, 0, 0, sequence)),
        ...overrides,
      };
      world.entries.push(row);
      return row;
    },
    restore: () => {
      for (const undo of saved.reverse()) undo();
      delete (mongoose.connection as unknown as Record<string, unknown>).readyState;
    },
  };

  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
  patch(mongoose, 'connect', async () => mongoose);

  // ------------------------------------------------------------------------------------------------- the ledger
  patch(CommissionEntry, 'aggregate', async (pipeline: Row[]) => {
    await Promise.resolve();
    return runPipeline(world.entries, pipeline);
  });
  patch(CommissionEntry, 'find', (filter: Row) => listChain(() => world.entries.filter((row) => matchRow(row, filter))));
  patch(CommissionEntry, 'countDocuments', async (filter: Row) => world.entries.filter((row) => matchRow(row, filter)).length);
  patch(CommissionEntry, 'updateMany', async (filter: Row, update: Row) => {
    await Promise.resolve();
    const set = (update.$set ?? {}) as Row;
    const keys = Object.keys(update);
    if (keys.length !== 1 || keys[0] !== '$set' || Object.keys(set).some((key) => key !== 'settledAt' && key !== 'payoutId')) {
      throw new Error('commission entries are append only: only settledAt and payoutId may change');
    }
    const claiming = set.payoutId !== null && set.payoutId !== undefined;
    let changed = 0;
    for (const row of world.entries) {
      if (!matchRow(row, filter)) continue;
      if (claiming && world.claimLimit !== null && changed >= world.claimLimit) break;
      if (claiming && world.claimCrashAfter !== null && changed >= world.claimCrashAfter) {
        world.claimCrashAfter = null;
        throw new Error('the request died while claiming');
      }
      row.settledAt = set.settledAt;
      row.payoutId = set.payoutId === null ? null : String(set.payoutId);
      changed += 1;
    }
    return { modifiedCount: changed };
  });

  // ------------------------------------------------------------------------------------------------- payouts
  patch(Payout, 'create', async (doc: Row) => {
    await Promise.resolve();
    if (doc.status === 'pending_settle' && world.payouts.some((row) => same(row.store, doc.store) && row.status === 'pending_settle')) {
      throw Object.assign(new Error('E11000 duplicate key error: store_one_pending_settle'), { code: 11000 });
    }
    const now = new Date();
    const row: Row = {
      _id: nextId(),
      note: null,
      paidAt: null,
      failedReason: null,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
      createdAt: now,
      updatedAt: now,
      ...doc,
      store: String(doc.store),
    };
    world.payouts.push(row);
    return { ...row };
  });
  patch(Payout, 'findById', (id: string) => oneChain(() => world.payouts.find((row) => same(row._id, id)) ?? null));
  patch(Payout, 'find', (filter: Row) => listChain(() => world.payouts.filter((row) => matchRow(row, filter))));
  patch(Payout, 'countDocuments', async (filter: Row) => world.payouts.filter((row) => matchRow(row, filter)).length);
  patch(Payout, 'aggregate', async (pipeline: Row[]) => {
    await Promise.resolve();
    return runPipeline(world.payouts, pipeline);
  });
  patch(Payout, 'findOneAndUpdate', (filter: Row, update: Row) => {
    const chain: Chain = {
      select: () => chain,
      sort: () => chain,
      skip: () => chain,
      limit: () => chain,
      lean: async () => {
        await Promise.resolve();
        const set = (update.$set ?? {}) as Row;
        if (set.status === 'paid' && world.crashBeforePaid) {
          world.crashBeforePaid = false;
          throw new Error('the request died before the last step');
        }
        const row = world.payouts.find((candidate) => matchRow(candidate, filter));
        if (!row) return null;
        Object.assign(row, set, { updatedAt: new Date() });
        return { ...row };
      },
    };
    return chain;
  });

  // ------------------------------------------------------------------------------- stores, owners, orders, audit
  patch(Store, 'findById', (id: string) => oneChain(() => world.stores[String(id)] ?? null));
  patch(Store, 'find', (filter: Row) => listChain(() => Object.values(world.stores).filter((row) => matchRow(row, filter))));
  patch(Store, 'findOne', (filter: Row) => oneChain(() => Object.values(world.stores).find((row) => matchRow(row, filter)) ?? null));
  patch(Store, 'exists', async (filter: Row) => {
    const found = Object.values(world.stores).find((row) => matchRow(row, filter));
    return found ? { _id: found._id } : null;
  });
  patch(User, 'findById', (id: string) => oneChain(() => world.users[String(id)] ?? null));
  patch(User, 'find', (filter: Row) => listChain(() => Object.values(world.users).filter((row) => matchRow(row, filter))));
  patch(Order, 'find', (filter: Row) => {
    const ids = ((filter._id as Row | undefined)?.$in ?? []) as string[];
    world.orderLookups.push(ids.map(String));
    return listChain(() => world.orders.filter((row) => matchRow(row, filter)));
  });
  patch(AuditLog, 'create', async (doc: Row) => {
    if (world.auditFails) throw new Error('the audit log is down');
    world.audits.push(doc);
    return { _id: nextId() };
  });

  // ---------------------------------------------------------------------------------------------- the outbox
  patch(NotificationOutbox, 'create', async (doc: Row) => {
    if (doc.dedupeKey !== undefined && world.outbox.some((row) => row.dedupeKey === doc.dedupeKey)) {
      throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
    }
    const row = { _id: nextId(), ...doc };
    world.outbox.push(row);
    return row;
  });
  patch(NotificationOutbox, 'findOne', (filter: Row) => oneChain(() => world.outbox.find((row) => row.dedupeKey === filter.dedupeKey) ?? null));
  // The first send claims nothing, so no provider is ever asked.
  patch(NotificationOutbox, 'findOneAndUpdate', () => oneChain(() => null));

  return world;
}
