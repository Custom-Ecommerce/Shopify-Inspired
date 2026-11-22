import { toTaxLine } from "@markaz/storefront-data";
import type { StorefrontOrder } from "@markaz/storefront-data";

/**
 * Sprint 8 (S8-B1, D-118): the money rows of an order confirmation, in the order the shopper reads them. Pure (no React), so a check file can read it.
 * The tax row appears only when the order carries tax: "Tax" for an exclusive tax (it is part of the total), "Tax (included)" for an inclusive one (it is already in the
 * prices and the total is unchanged). The label is the store's own name for it. An order from before tax, or a store with tax off, shows exactly the rows it always did.
 */

export interface OrderTotalRow {
  key: "subtotal" | "discount" | "delivery" | "tax" | "total";
  label: string;
  value: string;
  strong?: boolean;
}

const money = (amount: number): string => `Rs. ${Math.round(amount).toLocaleString("en-PK")}`;

type OrderMoney = Pick<StorefrontOrder, "subtotal" | "discount" | "deliveryCharges" | "total" | "taxAmount" | "taxMode" | "taxLabel">;

export function orderTotalRows(order: OrderMoney): OrderTotalRow[] {
  const rows: OrderTotalRow[] = [{ key: "subtotal", label: "Subtotal", value: money(order.subtotal) }];
  if (order.discount > 0) rows.push({ key: "discount", label: "Discount", value: `-${money(order.discount)}` });
  rows.push({ key: "delivery", label: "Delivery", value: order.deliveryCharges > 0 ? money(order.deliveryCharges) : "Free" });
  const tax = toTaxLine(order);
  if (tax) rows.push({ key: "tax", label: tax.label, value: money(tax.amount.amount) });
  rows.push({ key: "total", label: "Total", value: money(order.total), strong: true });
  return rows;
}
