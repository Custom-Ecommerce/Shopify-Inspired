import { cartItemCount, cartSubtotal } from "../domain/cart";
import type { CartLine } from "../domain/cart";
import { toMoney } from "../domain/money";
import type { Money } from "../domain/money";

export interface CartLineVM {
  id: string;
  productId: string;
  variantId: string;
  /** Null for a product with no options, so a theme shows no "Default" label. */
  variantTitle: string | null;
  slug: string;
  title: string;
  image: { url: string; alt: string } | null;
  unitPrice: Money;
  qty: number;
  lineTotal: Money;
}

export interface CartVM {
  lines: CartLineVM[];
  itemCount: number;
  subtotal: Money;
  isEmpty: boolean;
}

export function toCartVM(lines: CartLine[]): CartVM {
  return {
    lines: lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      variantId: line.variantId,
      variantTitle: line.variantTitle,
      slug: line.slug,
      title: line.title,
      image: line.image,
      unitPrice: toMoney(line.unitPrice),
      qty: line.qty,
      lineTotal: toMoney(line.unitPrice * line.qty),
    })),
    itemCount: cartItemCount(lines),
    subtotal: toMoney(cartSubtotal(lines)),
    isEmpty: lines.length === 0,
  };
}
