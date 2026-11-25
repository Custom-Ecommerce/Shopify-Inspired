/*
 * Sprint 8 (S8-B7, D-118): WHICH ORDERS COUNT, in one place. The same rule the analytics has had since the start (ID-28):
 *
 *   an ORDER (totals, orders per day, top cities)  every status except "cancelled". A returned order was still placed.
 *   REVENUE  (money per day, average order value, top products)  every status except "cancelled" and "returned". Pending orders count: they are placed orders.
 *
 * There is no "failed" status. The breakdown by status shows every status, cancelled included. Money is the order's own total (delivery and tax included), in
 * whole rupees; a product's revenue is unit price times quantity.
 */

export const NOT_AN_ORDER = ['cancelled'] as const;
export const NOT_REVENUE = ['cancelled', 'returned'] as const;

export const countsAsOrder = (status: string): boolean => !(NOT_AN_ORDER as readonly string[]).includes(status);
export const countsAsRevenue = (status: string): boolean => !(NOT_REVENUE as readonly string[]).includes(status);
