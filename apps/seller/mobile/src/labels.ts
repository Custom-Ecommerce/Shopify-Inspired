import { ORDER_PAYMENT_STATUS_LABELS, ORDER_STATUS_LABELS } from '@markaz/contracts/order';
import { SELLER_ROLE_LABELS, isSellerRole } from '@markaz/auth/seller-capabilities';

export const statusLabel = (status: string): string => (ORDER_STATUS_LABELS as Record<string, string>)[status] ?? 'Unknown';

export const paymentLabel = (method: string | null | undefined, status: string): string => {
  const how = method === 'card' ? 'Card' : 'Cash on delivery';
  return `${how}, ${((ORDER_PAYMENT_STATUS_LABELS as Record<string, string>)[status] ?? status).toLowerCase()}`;
};

export const roleLabel = (role: string): string => (isSellerRole(role) ? SELLER_ROLE_LABELS[role] : role);

/** The button that moves an order to a status. */
const ACTION_LABELS: Record<string, string> = {
  confirmed: 'Confirm order',
  processing: 'Start processing',
  dispatched: 'Dispatch order',
  delivered: 'Mark delivered',
};
export const actionLabel = (status: string): string => ACTION_LABELS[status] ?? `Move to ${statusLabel(status)}`;

export const PUSH_KIND_LABELS: Record<string, string> = {
  order_new: 'New orders',
  order_cancelled: 'Orders cancelled by the shopper',
  low_stock: 'Low stock',
  subscription_payment: 'Your subscription payments',
  support_reply: 'Replies from support',
};

const STOCK_LABELS: Record<string, string> = { in_stock: 'In stock', low_stock: 'Low stock', out_of_stock: 'Out of stock' };
export const stockLabel = (status: string): string => STOCK_LABELS[status] ?? status;

/** "0300 1234567" for a Pakistani mobile, as the website shows it; anything else as it is. */
export function displayPhone(phone: string | null): string {
  if (phone === null) return '';
  const match = /^\+923(\d{2})(\d{7})$/.exec(phone);
  return match ? `03${match[1]} ${match[2]}` : phone;
}

export const customerName = (name: string | null, phone: string | null, email: string | null): string => name?.trim() || displayPhone(phone) || email || 'Customer';
