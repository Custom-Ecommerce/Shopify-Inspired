import mongoose from 'mongoose';
import { normalizePhoneE164 } from '@/lib/contracts';
import { CustomerNote, EmailUnsubscribe, Order, Return } from '@/lib/services';

/**
 * Sprint 5 EP-10 test fixture: a store's orders, the customers' notes and the unsubscribes in memory, behind the Mongoose model
 * methods lib/customers.ts calls. No database.
 *
 * It RECOGNISES the pipelines lib/customers.ts builds and computes what the database would, in JavaScript: the key stages
 * ($addFields _email/_phoneKey, then _key), the two $group shapes (by _key with statistics, by _email for the broadcast), the
 * filters, sorts and the $facet. It throws on any stage or condition it does not know, so a changed query shape is noticed. It does
 * NOT evaluate the Mongo expressions themselves (that needs a real database): the group arithmetic here mirrors the intended rule.
 *
 * Every pipeline is recorded in `world.pipelines`, so a test can assert that the first stage is scoped by the store.
 */

export type Row = Record<string, any>;

const same = (a: unknown, b: unknown): boolean => String(a) === String(b);
const emptyish = (value: unknown): boolean => value === null || value === undefined;

function matchValue(value: unknown, cond: unknown): boolean {
  if (typeof cond === 'object' && cond !== null && !(cond instanceof Date) && !(cond instanceof mongoose.Types.ObjectId)) {
    const ops = cond as Row;
    return Object.entries(ops).every(([op, arg]) => {
      switch (op) {
        case '$ne':
          return !same(value, arg);
        case '$in':
          return (arg as unknown[]).some((candidate) => same(value, candidate));
        case '$nin':
          return !(arg as unknown[]).some((candidate) => (emptyish(candidate) ? emptyish(value) : same(value, candidate)));
        case '$gte':
          return Number(value) >= Number(arg);
        case '$regex':
          return typeof value === 'string' && new RegExp(arg as string, ops.$options ?? '').test(value);
        case '$options':
          return true;
        default:
          throw new Error('customers-world: unknown condition ' + op);
      }
    });
  }
  return same(value, cond);
}

function matches(doc: Row, filter: Row): boolean {
  return Object.entries(filter).every(([field, cond]) => {
    if (field === '$or') return (cond as Row[]).some((branch) => matches(doc, branch));
    return matchValue(doc[field], cond);
  });
}

const stamp = (date: Date): string => date.toISOString();

function addKeyFields(doc: Row): Row {
  return { ...doc, _email: String(doc.customerEmail ?? '').trim().toLowerCase(), _phoneKey: doc.phoneKey ?? '' };
}

function groupByKey(docs: Row[]): Row[] {
  const groups = new Map<string, Row>();
  for (const doc of docs) {
    const delivered = doc.status === 'delivered';
    const g = groups.get(doc._key) ?? {
      _id: doc._key,
      name: doc.customerName,
      whatsapp: doc.customerWhatsapp,
      phone: '',
      emailStamp: '',
      orders: 0,
      deliveredCount: 0,
      cancelledCount: 0,
      totalSpent: 0,
      firstOrderAt: doc.createdAt,
      lastOrderAt: doc.createdAt,
    };
    if (!groups.has(doc._key)) groups.set(doc._key, g);
    if (doc._phoneKey > g.phone) g.phone = doc._phoneKey;
    if (doc._email !== '') {
      const candidate = stamp(doc.createdAt) + '|' + doc._email;
      if (candidate > g.emailStamp) g.emailStamp = candidate;
    }
    g.orders += 1;
    if (delivered) g.deliveredCount += 1;
    if (doc.status === 'cancelled') g.cancelledCount += 1;
    if (delivered) g.totalSpent += Math.max(0, Number(doc.subtotal ?? 0) - Number(doc.discountAmount ?? 0));
    if (doc.createdAt < g.firstOrderAt) g.firstOrderAt = doc.createdAt;
    if (doc.createdAt > g.lastOrderAt) g.lastOrderAt = doc.createdAt;
  }
  return [...groups.values()];
}

function groupByEmail(docs: Row[]): Row[] {
  const groups = new Map<string, Row>();
  for (const doc of docs) {
    const g = groups.get(doc._email) ?? { _id: doc._email, email: doc._email, lastOrderAt: doc.createdAt };
    if (!groups.has(doc._email)) groups.set(doc._email, g);
    if (doc.createdAt > g.lastOrderAt) g.lastOrderAt = doc.createdAt;
  }
  return [...groups.values()];
}

function sortBy(docs: Row[], spec: Row): Row[] {
  const keys = Object.entries(spec);
  return [...docs].sort((a, b) => {
    for (const [field, dir] of keys) {
      const left = a[field] instanceof Date ? a[field].getTime() : a[field];
      const right = b[field] instanceof Date ? b[field].getTime() : b[field];
      if (left < right) return -1 * (dir as number);
      if (left > right) return 1 * (dir as number);
    }
    return 0;
  });
}

/** Runs one recognised pipeline over the given orders. */
export function runPipeline(orders: Row[], pipeline: Row[]): Row[] {
  let docs: Row[] = orders;
  for (const stage of pipeline) {
    if (stage.$match) {
      docs = docs.filter((doc) => matches(doc, stage.$match));
    } else if (stage.$addFields) {
      const fields = Object.keys(stage.$addFields);
      if (fields.includes('_email')) docs = docs.map(addKeyFields);
      else if (fields.includes('_key')) docs = docs.map((doc) => ({ ...doc, _key: doc._phoneKey !== '' ? doc._phoneKey : doc._email }));
      else if (fields.includes('email')) docs = docs.map((doc) => ({ ...doc, email: doc.emailStamp === '' ? '' : doc.emailStamp.slice(25) }));
      else throw new Error('customers-world: unknown $addFields ' + fields.join(','));
    } else if (stage.$sort) {
      docs = sortBy(docs, stage.$sort);
    } else if (stage.$group) {
      docs = stage.$group._id === '$_key' ? groupByKey(docs) : stage.$group._id === '$_email' ? groupByEmail(docs) : (() => {
        throw new Error('customers-world: unknown $group');
      })();
    } else if (stage.$limit !== undefined) {
      docs = docs.slice(0, stage.$limit);
    } else if (stage.$skip !== undefined) {
      docs = docs.slice(stage.$skip);
    } else if (stage.$project) {
      docs = docs.map((doc) => ({ ...doc }));
    } else if (stage.$count) {
      docs = docs.length === 0 ? [] : [{ [stage.$count]: docs.length }];
    } else if (stage.$facet) {
      const out: Row = {};
      for (const [name, sub] of Object.entries(stage.$facet as Record<string, Row[]>)) out[name] = runPipeline(docs, sub);
      return [out];
    } else {
      throw new Error('customers-world: unknown stage ' + Object.keys(stage).join(','));
    }
  }
  return docs;
}

export interface CustomersWorld {
  orders: Row[];
  notes: Row[];
  unsubs: Row[];
  pipelines: Row[][];
  noteWrites: Row[];
  /** Sprint 5 EP-13: the store's returns (store, contactPhone, status), read by the returns count. Empty by default. */
  returns: Row[];
  restore: () => void;
}

/** Installs the stubs on Order.aggregate, CustomerNote.find / findOneAndUpdate and EmailUnsubscribe.find. Call restore() afterwards. */
export function installCustomersWorld(): CustomersWorld {
  const OrderModel = Order as any;
  const NoteModel = CustomerNote as any;
  const UnsubModel = EmailUnsubscribe as any;
  const ReturnModel = Return as any;
  const saved = { aggregate: OrderModel.aggregate, find: NoteModel.find, upsert: NoteModel.findOneAndUpdate, unsubFind: UnsubModel.find, returnCount: ReturnModel.countDocuments };
  const world: CustomersWorld = { orders: [], notes: [], unsubs: [], pipelines: [], noteWrites: [], returns: [], restore: () => {} };

  const chain = (read: () => unknown) => {
    let limited: number | null = null;
    const q: any = {
      select: () => q,
      sort: () => q,
      limit: (n: number) => {
        limited = n;
        return q;
      },
      lean: async () => {
        const value = read();
        return Array.isArray(value) && limited !== null ? value.slice(0, limited) : value;
      },
    };
    return q;
  };

  OrderModel.aggregate = async (pipeline: Row[]) => {
    world.pipelines.push(pipeline);
    const first = pipeline[0]?.$match;
    if (!first || first.store === undefined) throw new Error('customers-world: a customer pipeline must start with a store $match');
    const mine = world.orders.filter((order) => same(order.store, first.store) && (first.phoneKey === undefined || order.phoneKey === first.phoneKey));
    // The first $match is applied here (store, and the phone index start); the rest of the pipeline starts after it.
    return runPipeline(mine, pipeline.slice(1));
  };
  NoteModel.find = (filter: Row) =>
    chain(() => world.notes.filter((note) => same(note.store, filter.store) && (filter.key.$in as string[]).includes(note.key)));
  NoteModel.findOneAndUpdate = (filter: Row, update: Row, options: Row) => {
    world.noteWrites.push({ filter, update, options });
    return chain(() => {
      let row = world.notes.find((note) => same(note.store, filter.store) && note.key === filter.key);
      if (!row) {
        row = { store: String(filter.store), key: filter.key, note: '', tags: [] };
        world.notes.push(row);
      }
      Object.assign(row, update.$set, { updatedAt: new Date('2026-11-20T12:00:00Z') });
      return structuredClone(row);
    });
  };
  UnsubModel.find = (filter: Row) =>
    chain(() =>
      world.unsubs.filter((u) => same(u.store, filter.store) && (filter.email === undefined || (filter.email.$in as string[]).includes(u.email))),
    );

  // The returns count of a customer: returns of the store, by contactPhone, whose status is not rejected (lib/returns.ts returnsCountFor).
  ReturnModel.countDocuments = async (filter: Row) =>
    world.returns.filter(
      (row) =>
        same(row.store, filter.store) &&
        row.contactPhone === filter.contactPhone &&
        (filter.status?.$ne === undefined || !same(row.status, filter.status.$ne)),
    ).length;

  world.restore = () => {
    ReturnModel.countDocuments = saved.returnCount;
    OrderModel.aggregate = saved.aggregate;
    NoteModel.find = saved.find;
    NoteModel.findOneAndUpdate = saved.upsert;
    UnsubModel.find = saved.unsubFind;
  };
  return world;
}

let clock = 0;

/**
 * An order as the storefront would have stored it: phone as typed, and phoneKey from the SAME rule checkout uses
 * (normalizePhoneE164), absent when the phone is not a mobile number. createdAt moves forward by a second per call.
 */
export function makeOrder(store: string, fields: Row = {}): Row {
  clock += 1;
  const phone = fields.phone ?? '';
  const key = normalizePhoneE164(phone);
  const order: Row = {
    _id: new mongoose.Types.ObjectId(),
    store,
    orderId: 'ORD-' + clock,
    customerName: fields.customerName ?? 'Customer ' + clock,
    customerEmail: fields.customerEmail ?? null,
    phone,
    customerWhatsapp: fields.customerWhatsapp ?? null,
    status: fields.status ?? 'pending',
    subtotal: fields.subtotal ?? 1000,
    discountAmount: fields.discountAmount ?? 0,
    total: fields.total ?? (fields.subtotal ?? 1000) + 200,
    paymentMethod: 'cod',
    paymentStatus: 'unpaid',
    address: fields.address ?? 'House 1, Street 2',
    city: fields.city ?? 'Lahore',
    createdAt: fields.createdAt ?? new Date(Date.UTC(2026, 10, 1) + clock * 60_000),
  };
  if (fields.phoneKey !== undefined) order.phoneKey = fields.phoneKey;
  else if (key !== null && fields.withoutKey !== true) order.phoneKey = key;
  return order;
}
