import { mobileSessionResponseSchema } from '@markaz/contracts/mobile';
import {
  mobileAlertListSchema,
  mobileCustomerDetailSchema,
  mobileCustomerListSchema,
  mobileDashboardSchema,
  mobileOrderDetailSchema,
  mobileOrderListSchema,
  mobileProductDetailSchema,
  mobileProductListSchema,
  mobileStoreListSchema,
  type MobileOrderPaymentFilter,
} from '@markaz/contracts/mobile-data';
import { MOBILE_V1, type ApiClient } from '@markaz/mobile-kit/core';
import { z } from 'zod';

/** Every request of the seller app, with the shapes of docs/mobile-api-v1.md checked on the way in. */

export type SignInBody = {
  email: string;
  password: string;
  deviceName: string;
  platform: 'android';
  appVersion: string;
  installationId: string;
};
export { mobileSessionResponseSchema };

export const PAGE_SIZE = 20;

export interface OrderFilters {
  status?: string;
  payment?: MobileOrderPaymentFilter;
  q?: string;
}

const orderAnswer = z.object({ order: mobileOrderDetailSchema, changed: z.boolean().optional() });

export const fetchStores = (client: ApiClient) => client.request({ method: 'GET', path: `${MOBILE_V1}/stores` }, mobileStoreListSchema);

export const fetchDashboard = (client: ApiClient, storeId: string) =>
  client.request({ method: 'GET', path: `${MOBILE_V1}/dashboard`, storeId }, mobileDashboardSchema);

export const fetchUnreadAlerts = async (client: ApiClient, storeId: string): Promise<number> =>
  (await client.request({ method: 'GET', path: `${MOBILE_V1}/alerts`, storeId, query: { limit: 1 } }, mobileAlertListSchema)).unread;

export const fetchOrders = (client: ApiClient, storeId: string, filters: OrderFilters, page: number) =>
  client.request(
    { method: 'GET', path: `${MOBILE_V1}/orders`, storeId, query: { status: filters.status, payment: filters.payment, q: filters.q, page, limit: PAGE_SIZE } },
    mobileOrderListSchema,
  );

export const fetchOrder = (client: ApiClient, storeId: string, orderId: string) =>
  client.request({ method: 'GET', path: `${MOBILE_V1}/orders/${orderId}`, storeId }, mobileOrderDetailSchema);

export interface StatusChange {
  status: string;
  courier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
}

export const changeOrderStatus = (client: ApiClient, storeId: string, orderId: string, revision: number, change: StatusChange, key: string) =>
  client.request(
    { method: 'POST', path: `${MOBILE_V1}/orders/${orderId}/status`, storeId, idempotencyKey: key, body: { revision, ...change } },
    orderAnswer,
  );

export const addOrderNote = (client: ApiClient, storeId: string, orderId: string, revision: number, text: string, key: string) =>
  client.request({ method: 'POST', path: `${MOBILE_V1}/orders/${orderId}/notes`, storeId, idempotencyKey: key, body: { revision, text } }, orderAnswer);

export const registerPushToken = (client: ApiClient, token: string | null) =>
  client.request({ method: 'POST', path: `${MOBILE_V1}/devices/push-token`, body: { token } });

export interface ProductFilters {
  q?: string;
  status?: 'published' | 'draft';
  stock?: 'low';
}

export const fetchProducts = (client: ApiClient, storeId: string, filters: ProductFilters, page: number) =>
  client.request(
    { method: 'GET', path: `${MOBILE_V1}/products`, storeId, query: { q: filters.q, status: filters.status, stock: filters.stock, page, limit: PAGE_SIZE } },
    mobileProductListSchema,
  );

export const fetchProduct = (client: ApiClient, storeId: string, productId: string) =>
  client.request({ method: 'GET', path: `${MOBILE_V1}/products/${productId}`, storeId }, mobileProductDetailSchema);

const productAnswer = z.object({ changed: z.boolean(), product: mobileProductDetailSchema });

export const setStockCount = (client: ApiClient, storeId: string, productId: string, revision: number, variantId: string, quantity: number, key: string) =>
  client.request(
    { method: 'POST', path: `${MOBILE_V1}/products/${productId}/stock`, storeId, idempotencyKey: key, body: { revision, variantId, quantity } },
    productAnswer,
  );

export const setPrice = (
  client: ApiClient,
  storeId: string,
  productId: string,
  revision: number,
  change: { variantId: string; price: number; compareAtPrice?: number | null },
  key: string,
) => client.request({ method: 'POST', path: `${MOBILE_V1}/products/${productId}/price`, storeId, idempotencyKey: key, body: { revision, ...change } }, productAnswer);

export const fetchCustomers = (client: ApiClient, storeId: string, filters: { q?: string; sort?: string }, page: number) =>
  client.request(
    { method: 'GET', path: `${MOBILE_V1}/customers`, storeId, query: { q: filters.q, sort: filters.sort, page, limit: PAGE_SIZE } },
    mobileCustomerListSchema,
  );

export const fetchCustomer = (client: ApiClient, storeId: string, customerKey: string) =>
  client.request({ method: 'GET', path: `${MOBILE_V1}/customers/${encodeURIComponent(customerKey)}`, storeId }, mobileCustomerDetailSchema);

export const fetchAlerts = (client: ApiClient, storeId: string, page: number) =>
  client.request({ method: 'GET', path: `${MOBILE_V1}/alerts`, storeId, query: { page, limit: PAGE_SIZE } }, mobileAlertListSchema);

export const markAlertRead = (client: ApiClient, storeId: string, alertId: string) =>
  client.request({ method: 'POST', path: `${MOBILE_V1}/alerts/${alertId}/read`, storeId });

export const markAllAlertsRead = (client: ApiClient, storeId: string) =>
  client.request({ method: 'POST', path: `${MOBILE_V1}/alerts/read-all`, storeId });
