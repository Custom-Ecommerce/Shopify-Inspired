import mongoose from 'mongoose';
import { AuditLog, CommissionEntry, NotificationOutbox, Order, Product, Return, SellerAlert, StockMovement, Store, User } from '@/lib/services';

/**
 * Sprint 5 EP-13 test fixture: stores, the seller accounts, orders, returns, the stock of one product, the commission ledger, stock movements
 * and the audit log in memory, behind the Mongoose model methods the return code calls. No database.
 *
 * Every write matches and changes ONE row in one synchronous step after a single yield, as MongoDB does for one document, so two parallel
 * requests that both read before either writes really have one winner. It understands the filters the return code uses (equality, $ne, $in,
 * $exists) and throws on any other operator, so a changed query shape is noticed. The unique indexes are emulated: { store, returnNumber } on
 * returns and { order, type, reversesType, returnId } on the ledger.
 */

export type Row = Record<string, any>;

export const SECRET = 'x'.repeat(40);
export const USER_A = '65a000000000000000000001';
export const USER_B = '65a000000000000000000002';
export const ADMIN = '65a000000000000000000003';
export const STORE_A = '65a000000000000000000011';
export const STORE_B = '65a000000000000000000012';
export const ORDER_A = '65a0000000000000000a0001';
export const ORDER_B = '65a0000000000000000a0002';
export const P1 = '65a0000000000000000c0001';
export const V1 = '65a0000000000000000d0001';
export const P2 = '65a0000000000000000c0002';
export const V2 = '65a0000000000000000d0002';
export const PHONE = '+923001234567';
export const PHONE_LOCAL = '0300 1234567';
const T0 = new Date('2026-11-14T10:00:00Z');

const same = (a: unknown, b: unknown): boolean => String(a) === String(b);
const isNil = (value: unknown): boolean => value === null || value === undefined;

function matchValue(value: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === 'object' && !(cond instanceof Date) && !(cond instanceof mongoose.Types.ObjectId)) {
    return Object.entries(cond as Row).every(([op, arg]) => {
      switch (op) {
        case '$ne':
          return isNil(arg) ? !isNil(value) : !same(value, arg);
        case '$in':
          return (arg as unknown[]).some((candidate) => (isNil(candidate) ? isNil(value) : same(value, candidate)));
        case '$exists':
          return (value !== undefined) === Boolean(arg);
        default:
          throw new Error('returns-world: unknown condition ' + op);
      }
    });
  }
  return isNil(cond) ? isNil(value) : same(value, cond);
}

export const matches = (row: Row, filter: Row): boolean => Object.entries(filter).every(([key, cond]) => matchValue(row[key], cond));

const chain = (read: () => unknown) => {
  let sortSpec: Row | null = null;
  let skipped = 0;
  let cap: number | null = null;
  const q: any = {
    select: () => q,
    sort: (spec: Row) => {
      sortSpec = spec;
      return q;
    },
    skip: (n: number) => {
      skipped = n;
      return q;
    },
    limit: (n: number) => {
      cap = n;
      return q;
    },
    lean: async () => {
      const value = read();
      if (!Array.isArray(value)) return value;
      let rows = [...value];
      if (sortSpec) {
        const [[field, dir]] = Object.entries(sortSpec) as Array<[string, number]>;
        rows.sort((a, b) => ((a[field] as Date) < (b[field] as Date) ? -1 : (a[field] as Date) > (b[field] as Date) ? 1 : 0) * dir);
      }
      rows = rows.slice(skipped);
      return cap === null ? rows : rows.slice(0, cap);
    },
  };
  return q;
};

/** Applies a Mongo update ($set, $push with $each) to a stored row. */
function applyUpdate(row: Row, update: Row): void {
  Object.assign(row, update.$set ?? {});
  for (const [key, value] of Object.entries(update.$push ?? {}) as Array<[string, any]>) {
    const adds = value && typeof value === 'object' && '$each' in value ? value.$each : [value];
    row[key] = [...(row[key] ?? []), ...adds];
  }
  row.updatedAt = new Date();
}

const clone = (row: Row): Row => ({ ...row });

export interface ReturnsWorld {
  stores: Row[];
  users: Record<string, Row>;
  orders: Row[];
  returns: Row[];
  ledger: Row[];
  /** What the notification code queued after the response (emails) and the seller's bell alerts. */
  outbox: Row[];
  alerts: Row[];
  movements: Row[];
  audits: Row[];
  /** The stock of the variants of the two products: variantId -> quantity. */
  stock: Record<string, number>;
  returnWrites: number;
  orderWrites: number;
  /** Makes the next order read wait until `expected` readers have arrived (so parallel requests all read before any writes). */
  holdReads: (model: 'return', expected: number) => void;
  /** An order of store A, delivered two days ago, two lines (P1/V1 x2 at 1000, P2/V2 x1 at 500), subtotal 2500, discount 250. */
  order: (fields?: Row) => Row;
  /** A return row as the seller routes read it. */
  ret: (fields?: Row) => Row;
  restore: () => void;
}

export function installReturnsWorld(): ReturnsWorld {
  const OrderModel = Order as any;
  const ReturnModel = Return as any;
  const StoreModel = Store as any;
  const UserModel = User as any;
  const ProductModel = Product as any;
  const MovementModel = StockMovement as any;
  const AuditModel = AuditLog as any;
  const EntryModel = CommissionEntry as any;
  const saved = {
    connect: (mongoose as any).connect,
    readyState: Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState'),
    methods: [
      [OrderModel, ['findOne', 'find', 'findOneAndUpdate']],
      [ReturnModel, ['create', 'find', 'findOne', 'findOneAndUpdate', 'countDocuments', 'aggregate', 'deleteOne']],
      [StoreModel, ['findOne', 'exists', 'findById']],
      [UserModel, ['findById']],
      [ProductModel, ['findOneAndUpdate', 'exists']],
      [MovementModel, ['create']],
      [AuditModel, ['create']],
      [EntryModel, ['create', 'find', 'findOne']],
      [NotificationOutbox as any, ['create', 'findOne', 'findOneAndUpdate']],
      [SellerAlert as any, ['create']],
    ] as Array<[Row, string[]]>,
  };
  const originals = saved.methods.map(([model, names]) => [model, Object.fromEntries(names.map((name) => [name, model[name]]))] as [Row, Row]);

  let seq = 0;
  let gate: { expected: number; arrived: number; release: () => void; released: Promise<void> } | null = null;
  const world: ReturnsWorld = {
    stores: [
      { _id: STORE_A, owner: USER_A, name: 'Zara Lawn', slug: 'zara', status: 'active', storefront: {}, paymentSettings: { codEnabled: true, cardEnabled: false } },
      { _id: STORE_B, owner: USER_B, name: 'Bilal Shoes', slug: 'bilal', status: 'active', storefront: {}, paymentSettings: { codEnabled: true, cardEnabled: false } },
    ],
    users: {
      [USER_A]: { _id: USER_A, role: 'seller', email: 'a@seller.test', emailVerifiedAt: T0 },
      [USER_B]: { _id: USER_B, role: 'seller', email: 'b@seller.test', emailVerifiedAt: T0 },
      [ADMIN]: { _id: ADMIN, role: 'admin', email: 'admin@markazify.test', emailVerifiedAt: T0 },
    },
    orders: [],
    returns: [],
    ledger: [],
    outbox: [],
    alerts: [],
    movements: [],
    audits: [],
    stock: { [V1]: 5, [V2]: 5 },
    returnWrites: 0,
    orderWrites: 0,
    holdReads: (_model, expected) => {
      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      gate = { expected, arrived: 0, release, released };
    },
    order: (fields = {}) => {
      const row: Row = {
        _id: ORDER_A,
        store: STORE_A,
        orderId: 'ORD-ABCD2345',
        status: 'delivered',
        paymentMethod: 'cod',
        paymentStatus: 'collected',
        phone: PHONE,
        phoneKey: PHONE,
        customerName: 'Sara Khan',
        customerEmail: 'sara@example.pk',
        items: [
          { productId: P1, variantId: V1, productTitle: 'Shirt', variantTitle: 'M', sku: 'SH-M', unitPrice: 1000, quantity: 2, stockDeducted: true },
          { productId: P2, variantId: V2, productTitle: 'Cap', variantTitle: 'Default', sku: null, unitPrice: 500, quantity: 1, stockDeducted: true },
        ],
        subtotal: 2500,
        discountAmount: 250,
        deliveryCharges: 200,
        total: 2450,
        statusHistory: [{ from: 'dispatched', to: 'delivered', by: null, at: new Date(Date.now() - 2 * 86_400_000), note: null }],
        createdAt: new Date(Date.now() - 6 * 86_400_000),
        ...fields,
      };
      world.orders.push(row);
      return row;
    },
    ret: (fields = {}) => {
      seq += 1;
      const row: Row = {
        _id: '65a0000000000000000e' + String(seq).padStart(4, '0'),
        store: STORE_A,
        order: ORDER_A,
        orderNumber: 'ORD-ABCD2345',
        returnNumber: 'RET-AAAA' + String(1000 + seq),
        contactPhone: PHONE,
        reason: 'damaged',
        reasonCode: 'damaged',
        description: null,
        status: 'requested',
        images: [],
        refundAmount: null,
        items: [
          { productId: P1, variantId: V1, productTitle: 'Shirt', variantTitle: 'M', quantity: 2, unitPrice: 1000 },
          { productId: P2, variantId: V2, productTitle: 'Cap', variantTitle: 'Default', quantity: 1, unitPrice: 500 },
        ],
        createdAt: new Date(Date.UTC(2026, 10, 14, 10, seq)),
        updatedAt: new Date(Date.UTC(2026, 10, 14, 10, seq)),
        ...fields,
      };
      world.returns.push(row);
      return row;
    },
    restore: () => {
      for (const [model, methods] of originals) for (const [name, fn] of Object.entries(methods)) model[name] = fn;
      (mongoose as any).connect = saved.connect;
      if (saved.readyState) Object.defineProperty(mongoose.connection, 'readyState', saved.readyState);
      else delete (mongoose.connection as unknown as Row).readyState;
    },
  };

  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
  (mongoose as any).connect = async () => mongoose;

  // ------------------------------------------------------------------------------------------------------ stores and users
  StoreModel.findOne = (filter: Row) =>
    chain(() => {
      const store = world.stores.find((s) => matches(s, filter));
      return store ? clone(store) : null;
    });
  StoreModel.exists = async (filter: Row) => (world.stores.some((s) => matches(s, filter)) ? { _id: filter._id } : null);
  StoreModel.findById = (id: unknown) => chain(() => (world.stores.find((s) => same(s._id, id)) ? clone(world.stores.find((s) => same(s._id, id))!) : null));
  UserModel.findById = (id: unknown) => chain(() => world.users[String(id)] ?? null);

  // ---------------------------------------------------------------------------------------------------------------- orders
  OrderModel.findOne = (filter: Row) => chain(() => (world.orders.find((o) => matches(o, filter)) ? clone(world.orders.find((o) => matches(o, filter))!) : null));
  OrderModel.find = (filter: Row) => chain(() => world.orders.filter((o) => matches(o, filter)).map(clone));
  OrderModel.findOneAndUpdate = (filter: Row, update: Row) => ({
    lean: async () => {
      await Promise.resolve();
      const row = world.orders.find((o) => matches(o, filter));
      if (!row) return null;
      world.orderWrites += 1;
      applyUpdate(row, update);
      return clone(row);
    },
  });

  // --------------------------------------------------------------------------------------------------------------- returns
  ReturnModel.create = async (doc: Row) => {
    await Promise.resolve();
    if (doc.returnNumber !== undefined && world.returns.some((r) => same(r.store, doc.store) && r.returnNumber === doc.returnNumber)) {
      throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
    }
    seq += 1;
    const now = new Date(Date.UTC(2026, 10, 14, 11, seq));
    const row: Row = { _id: '65a0000000000000000e' + String(seq).padStart(4, '0'), images: [], refundAmount: null, createdAt: now, updatedAt: now, ...doc, store: String(doc.store), order: String(doc.order) };
    world.returns.push(row);
    return clone(row);
  };
  ReturnModel.find = (filter: Row) => chain(() => world.returns.filter((r) => matches(r, filter)).map(clone));
  ReturnModel.countDocuments = async (filter: Row) => world.returns.filter((r) => matches(r, filter)).length;
  ReturnModel.deleteOne = (filter: Row) =>
    Promise.resolve().then(() => {
      const index = world.returns.findIndex((r) => matches(r, filter));
      if (index !== -1) world.returns.splice(index, 1);
      return { deletedCount: index === -1 ? 0 : 1 };
    });
  ReturnModel.aggregate = async (pipeline: Row[]) => {
    const match = pipeline[0]?.$match ?? {};
    const groups = new Map<string, number>();
    for (const r of world.returns.filter((row) => matches(row, match))) groups.set(String(r.status), (groups.get(String(r.status)) ?? 0) + 1);
    return [...groups.entries()].map(([status, count]) => ({ _id: status, count }));
  };
  ReturnModel.findOne = (filter: Row) => ({
    select: () => ReturnModel.findOne(filter),
    lean: async () => {
      const found = world.returns.find((r) => matches(r, filter));
      const snapshot = found ? clone(found) : null;
      if (gate && gate.arrived < gate.expected) {
        gate.arrived += 1;
        if (gate.arrived === gate.expected) gate.release();
        await gate.released;
      }
      return snapshot;
    },
  });
  ReturnModel.findOneAndUpdate = (filter: Row, update: Row, options?: Row) => ({
    lean: async () => {
      await Promise.resolve();
      const row = world.returns.find((r) => matches(r, filter));
      if (!row) return null;
      world.returnWrites += 1;
      applyUpdate(row, update);
      return options?.new === false ? null : clone(row);
    },
  });

  // ---------------------------------------------------------------------------------------------------- stock and movements
  ProductModel.findOneAndUpdate = (filter: Row, update: Row) => {
    const variantId = String(filter.variants?.$elemMatch?._id);
    return chain(() => {
      if (!(variantId in world.stock)) return null;
      world.stock[variantId] = world.stock[variantId]! + update.$inc['variants.$.stockQuantity'];
      return { variants: Object.entries(world.stock).map(([id, stockQuantity]) => ({ _id: id, stockQuantity })) };
    });
  };
  ProductModel.exists = async () => ({ _id: P1 });
  MovementModel.create = async (doc: Row) => {
    world.movements.push(doc);
    return doc;
  };
  AuditModel.create = async (doc: Row) => {
    world.audits.push(doc);
    return { _id: new mongoose.Types.ObjectId() };
  };

  // -------------------------------------------------------------------------------------------------------------- the ledger
  EntryModel.create = async (doc: Row) => {
    await Promise.resolve();
    if (world.ledger.some((e) => same(e.order, doc.order) && e.type === doc.type && String(e.reversesType ?? null) === String(doc.reversesType ?? null) && String(e.returnId ?? null) === String(doc.returnId ?? null))) {
      throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
    }
    const row = { _id: String(world.ledger.length + 1), createdAt: new Date(), ...doc };
    world.ledger.push(row);
    return clone(row);
  };
  EntryModel.find = (filter: Row) => chain(() => world.ledger.filter((e) => matches(e, filter)).map(clone));
  EntryModel.findOne = (filter: Row) => chain(() => (world.ledger.find((e) => matches(e, filter)) ? clone(world.ledger.find((e) => matches(e, filter))!) : null));

  // ------------------------------------------------------------------------------------- notifications (run after the response)
  const dup = () => Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
  const OutboxModel = NotificationOutbox as any;
  const AlertModel = SellerAlert as any;
  OutboxModel.create = async (doc: Row) => {
    if (doc.dedupeKey !== undefined && world.outbox.some((r) => r.dedupeKey === doc.dedupeKey)) throw dup();
    const row = { _id: new mongoose.Types.ObjectId(), ...doc };
    world.outbox.push(row);
    return row;
  };
  OutboxModel.findOne = (filter: Row) => chain(() => world.outbox.find((r) => r.dedupeKey === filter.dedupeKey) ?? null);
  // The first send claims nothing, so no provider is ever asked.
  OutboxModel.findOneAndUpdate = () => chain(() => null);
  AlertModel.create = async (doc: Row) => {
    if (world.alerts.some((a) => a.open && String(a.store) === String(doc.store) && a.dedupeKey === doc.dedupeKey)) throw dup();
    const row = { _id: new mongoose.Types.ObjectId(), ...doc };
    world.alerts.push(row);
    return row;
  };

  return world;
}

/** Lets the work queued after a response finish (the notification code runs after the response). */
export const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 40));
