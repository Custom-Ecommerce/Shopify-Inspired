import { adminOrderDetailResponseSchema, adminOrderListSchema } from '@markaz/contracts/admin-orders';
import { adminOverviewSchema } from '@markaz/contracts/admin-overview';
import { adminPaymentListSchema } from '@markaz/contracts/subscription-payments';
import type { ApiClient } from '@markaz/mobile-kit/core';
import { z } from 'zod';

/*
 * Every request of the admin app. They are the console's own /api/admin routes with the phone's access token, so the same capability checks, rules and
 * audit entries apply. Shapes the console has no shared schema for are checked here (only what the screens read).
 */

const ADMIN = '/api/admin';
export const PAGE_SIZE = 20;

const meSchema = z.object({ user: z.object({ id: z.string(), name: z.string(), email: z.string() }), adminLevel: z.string(), capabilities: z.array(z.string()) });

export const fetchMe = (client: ApiClient) => client.request({ method: 'GET', path: `${ADMIN}/me` }, meSchema);

export const fetchOverview = (client: ApiClient) => client.request({ method: 'GET', path: `${ADMIN}/overview` }, adminOverviewSchema);

export const fetchOrders = (client: ApiClient, filters: { status?: string; q?: string }, page: number) =>
  client.request({ method: 'GET', path: `${ADMIN}/orders`, query: { status: filters.status, q: filters.q, page, limit: PAGE_SIZE } }, adminOrderListSchema);

export const fetchOrder = async (client: ApiClient, id: string) =>
  (await client.request({ method: 'GET', path: `${ADMIN}/orders/${id}` }, adminOrderDetailResponseSchema)).order;

/** The claims waiting for a decision (at most 100, newest first). */
export const fetchPendingPayments = (client: ApiClient) =>
  client.request({ method: 'GET', path: `${ADMIN}/subscription-payments`, query: { status: 'claimed', limit: 100 } }, adminPaymentListSchema);

export const confirmPayment = (client: ApiClient, id: string, amountRs: number, reason: string) =>
  client.request({ method: 'POST', path: `${ADMIN}/subscription-payments/${id}/confirm`, body: { amountRs, reason } });

export const rejectPayment = (client: ApiClient, id: string, reason: string) =>
  client.request({ method: 'POST', path: `${ADMIN}/subscription-payments/${id}/reject`, body: { reason } });

const ticketRow = z.object({
  id: z.string(),
  subject: z.string(),
  status: z.string(),
  revision: z.number(),
  messageCount: z.number(),
  lastMessageAt: z.string().nullable(),
  lastFrom: z.string().nullable(),
  orderRef: z.string().nullable(),
  sellerName: z.string().nullable(),
  sellerEmail: z.string().nullable(),
});
export type TicketRow = z.output<typeof ticketRow>;
const ticketList = z.object({ docs: z.array(ticketRow), page: z.number(), totalPages: z.number() });
const ticketDetail = z.object({ ticket: ticketRow.extend({ messages: z.array(z.object({ from: z.string(), text: z.string(), at: z.string().nullable() })) }) });
export type TicketDetail = z.output<typeof ticketDetail>['ticket'];

export const fetchTickets = (client: ApiClient, status: string | undefined, page: number) =>
  client.request({ method: 'GET', path: `${ADMIN}/tickets`, query: { status, page, limit: PAGE_SIZE } }, ticketList);

export const fetchTicket = async (client: ApiClient, id: string) => (await client.request({ method: 'GET', path: `${ADMIN}/tickets/${id}` }, ticketDetail)).ticket;

export const replyTicket = (client: ApiClient, id: string, revision: number, text: string) =>
  client.request({ method: 'POST', path: `${ADMIN}/tickets/${id}/reply`, body: { revision, text } });

export const setTicketStatus = (client: ApiClient, id: string, revision: number, status: string) =>
  client.request({ method: 'POST', path: `${ADMIN}/tickets/${id}/status`, body: { revision, status } });

const sellerList = z.object({
  docs: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      storeCount: z.number(),
      createdAt: z.string(),
      accountStatus: z.string(),
      stores: z.array(z.object({ id: z.string(), name: z.string(), status: z.string() })),
    }),
  ),
  page: z.number(),
  totalPages: z.number(),
});
export type SellerRow = z.output<typeof sellerList>['docs'][number];

export const fetchSellers = (client: ApiClient, q: string | undefined, page: number) =>
  client.request({ method: 'GET', path: `${ADMIN}/sellers`, query: { q, page, limit: PAGE_SIZE } }, sellerList);

const syncSchema = z.object({
  counts: z.object({ pending: z.number(), sent: z.number(), dead: z.number() }),
  oldestPendingAt: z.string().nullable(),
  lastSentAt: z.string().nullable(),
  events: z.object({
    docs: z.array(z.object({ id: z.string(), entity: z.string(), target: z.string(), attempts: z.number(), lastError: z.string().nullable(), createdAt: z.string() })),
  }),
});

/** The events that could not be delivered, and the health of the outbox. */
export const fetchSync = (client: ApiClient) => client.request({ method: 'GET', path: `${ADMIN}/sync/outbox`, query: { status: 'dead', limit: 20 } }, syncSchema);

export const registerPushToken = (client: ApiClient, token: string | null) =>
  client.request({ method: 'POST', path: '/api/admin/mobile/v1/devices/push-token', body: { token } });
