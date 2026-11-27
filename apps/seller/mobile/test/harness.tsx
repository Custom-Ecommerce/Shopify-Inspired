import { createMobileRuntime, memoryStore } from '@markaz/mobile-kit/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import type { PushPort } from '../src/push';
import { ServicesProvider, StoreProvider, type Services } from '../src/services';

export const BASE = 'http://192.168.1.5:4001';
export const STORE = '65b000000000000000000001';
export const STORE2 = '65b000000000000000000002';
export const ORDER = '65c000000000000000000001';
const STAMP = { revision: 100, updatedAt: '2026-11-20T10:00:00.000Z' };

export interface Seen {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: any;
}
export type Reply = { status?: number; body?: unknown } | 'offline' | undefined;

export const orderItem = (n: number, over: object = {}) => ({
  id: `65c0000000000000000000${String(n).padStart(2, '0')}`,
  orderId: `ORD-${1000 + n}`,
  status: 'pending',
  paymentMethod: 'cod',
  paymentStatus: 'unpaid',
  customerName: 'Ayesha',
  phone: '+923001234567',
  city: 'Lahore',
  total: 2500,
  itemCount: 1,
  courier: null,
  trackingNumber: null,
  createdAt: '2026-11-20T09:00:00.000Z',
  ...STAMP,
  ...over,
});

export const orderDetail = (over: object = {}) => ({
  id: ORDER,
  orderId: 'ORD-1001',
  status: 'pending',
  paymentMethod: 'cod',
  paymentStatus: 'unpaid',
  collectedAt: null,
  collectedAmount: null,
  paidAt: null,
  stripeSessionId: null,
  customerName: 'Ayesha',
  phone: '+923001234567',
  address: 'House 1, Street 2',
  city: 'Lahore',
  customerEmail: null,
  customerWhatsapp: null,
  customerNote: null,
  items: [{ productTitle: 'Shawl', variantTitle: 'Blue', sku: 'S-1', unitPrice: 1200, quantity: 2, lineTotal: 2400, stockDeducted: true }],
  subtotal: 2400,
  deliveryCharges: 200,
  discountCode: null,
  discountAmount: 0,
  total: 3000,
  courier: null,
  trackingNumber: null,
  trackingUrl: null,
  statusHistory: [],
  notes: [],
  cancelledAt: null,
  cancelReason: null,
  createdAt: '2026-11-20T09:00:00.000Z',
  allowedNext: ['confirmed'],
  canCancel: true,
  canEditTracking: false,
  canMarkCollected: false,
  timeline: [{ id: 't1', kind: 'placed', at: '2026-11-20T09:00:00.000Z', title: 'Order placed', detail: null }],
  taxAmount: 400,
  taxMode: 'exclusive',
  taxRatePercent: 17,
  taxLabel: 'GST',
  ...STAMP,
  ...over,
});

export const dashboard = (over: object = {}) => ({
  storeId: STORE,
  ordersToday: 3,
  pendingOrders: 2,
  unconfirmedOrders: 1,
  lowStockProducts: 4,
  revenueThisMonth: 90000,
  salesToday: 1500,
  salesThisWeek: 12000,
  recentOrders: [orderItem(1)],
  ...STAMP,
  ...over,
});

export const storeRow = (id = STORE, role = 'owner', name = 'Ayesha Shawls') => ({ id, name, slug: 'shop', status: 'active', role, logoUrl: null, ...STAMP });

export const orderPage = (docs: unknown[], over: object = {}) => ({
  docs,
  page: 1,
  limit: 20,
  totalDocs: docs.length,
  totalPages: docs.length ? 1 : 0,
  counts: { all: docs.length, pending: docs.length, confirmed: 0, processing: 0, dispatched: 0, delivered: 0, cancelled: 0, returned: 0 },
  unconfirmedCount: 0,
  ...over,
});

export const fakePush = (over: Partial<PushPort> = {}): PushPort => ({
  available: () => ({ ok: false, reason: 'Expo Go cannot receive push notifications. The installed app can.' }),
  register: async () => ({ ok: false, reason: 'no' }),
  onTap: () => () => undefined,
  ...over,
});

export interface Setup {
  /** Answers a request; undefined falls back to the defaults (one owner store). */
  handler?: (request: Seen) => Reply;
  role?: string;
  stores?: ReturnType<typeof storeRow>[];
  push?: PushPort;
  signIn?: boolean;
}

export async function setup(options: Setup = {}) {
  const seen: Seen[] = [];
  let ready = options.signIn === false;
  const fetch = (async (input: unknown, init: any = {}) => {
    const url = String(input);
    const [path, search = ''] = url.slice(BASE.length).split('?');
    const request: Seen = {
      method: init.method,
      path: path!,
      query: Object.fromEntries(new URLSearchParams(search)),
      headers: init.headers,
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    seen.push(request);
    // The harness's own sign-in always gets the default answer.
    let reply = ready ? options.handler?.(request) : undefined;
    if (reply === undefined) {
      if (path!.endsWith('/auth/login')) {
        reply = {
          body: {
            accessToken: 'a1',
            accessTokenExpiresIn: 900,
            refreshToken: 'r1',
            refreshTokenExpiresAt: '2026-12-26T00:00:00.000Z',
            deviceId: 'd1',
            user: { id: 'u1', name: 'Ayesha', email: 'a@x.pk', role: 'seller' },
          },
        };
      } else if (path!.endsWith('/stores')) reply = { body: { stores: options.stores ?? [storeRow(STORE, options.role ?? 'owner')] } };
      else reply = { status: 404, body: { errors: [{ message: 'Not found' }] } };
    }
    if (reply === 'offline') throw new TypeError('Network request failed');
    const { status = 200, body } = reply;
    return { status, headers: { get: () => null }, text: async () => JSON.stringify(body ?? {}) };
  }) as unknown as typeof globalThis.fetch;

  let n = 0;
  const storage = memoryStore();
  const runtime = createMobileRuntime({
    app: 'seller',
    baseUrl: BASE,
    appVersion: '1.0.0',
    secrets: memoryStore(),
    storage,
    random: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    fetch,
  });
  await runtime.session.restore();
  if (options.signIn !== false) {
    await runtime.session.signIn({});
    seen.length = 0;
    ready = true;
  }
  const services: Services = { runtime, storage, appVersion: '1.0.0', deviceName: 'Test phone', portalUrl: 'https://seller.example', push: options.push ?? fakePush() };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

  const show = (ui: ReactElement) =>
    render(
      <QueryClientProvider client={queryClient}>
        <ServicesProvider value={services}>
          <StoreProvider>{ui}</StoreProvider>
        </ServicesProvider>
      </QueryClientProvider>,
    );

  const requests = (path: string, method?: string) => seen.filter((r) => r.path.endsWith(path) && (!method || r.method === method));
  return { seen, requests, runtime, storage, services, queryClient, show };
}
