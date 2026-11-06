"use client";

import { productMatchesCategory } from "../../shared/lib/productCategoryMatch";
import type { CartDrawerData, NormalizedCategory, NormalizedProduct } from "../../types";
import { Minus, Plus, ShoppingCart, Trash2, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { paths } from "../../adapters/paths";
import { Button } from "../../shared/components/primitives/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "../../shared/components/primitives/sheet";
import { headerDictionary } from "../../shared/constants/dictionary";
import { parseNumericPrice, useCartContext } from "../../shared/context/CartContext";
import { useStoreData } from "../../shared/context/StoreDataContext";

export interface CartDrawerProps {
  data?: CartDrawerData;
}

const formatCurrency = (amount: number) => {
  return `Rs. ${Math.round(amount).toLocaleString("en-PK")}`;
};

function CartCategoryCarousel({
  products,
  onItemClick,
}: {
  products: NormalizedProduct[];
  onItemClick: () => void;
}) {
  if (products.length === 0) {
    return (
      <p className="text-[11px] font-sans text-[var(--nav-mobile-text)]/40 italic py-1">
        No products available in this category
      </p>
    );
  }

  return (
    <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-none snap-x snap-mandatory w-full">
      {products.map((product) => {
        const firstImg = product.images[0] || "/placeholder.jpg";
        const productLink = product.link || paths.product(product.handle);

        return (
          <Link
            key={product.id}
            href={productLink}
            onClick={onItemClick}
            className="snap-start shrink-0 w-24 flex flex-col gap-1.5 group cursor-pointer"
          >
            <div className="relative aspect-[3/4] w-full bg-[var(--nav-mobile-text)]/10 rounded-lg overflow-hidden border border-[var(--nav-mobile-text)]/10 group-hover:border-[var(--nav-mobile-text)]/40 transition-colors">
              <Image
                src={firstImg}
                alt={product.title}
                fill
                sizes="96px"
                className="object-cover group-hover:scale-105 transition-transform duration-300"
              />
            </div>

            <div className="flex flex-col">
              <h4 className="font-sans text-[11px] font-medium text-[var(--nav-mobile-text)]/90 truncate leading-tight group-hover:text-[var(--nav-mobile-text)]">
                {product.title}
              </h4>
              <p className="font-sans text-[11px] font-bold text-[var(--nav-mobile-text)]/70 mt-0.5">
                {product.price}
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

export function CartDrawer(props: CartDrawerProps) {
  const customData = props.data;

  const {
    cartItems,
    cartCount,
    subtotal,
    isCartOpen,
    setIsCartOpen,
    updateQuantity,
    removeFromCart,
  } = useCartContext();

  const { products, categories } = useStoreData();

  const cartLineIds = new Set(cartItems.map((item) => item.lineId));
  const availableProducts = products.filter(
    (p) => !p.variants?.some((v) => cartLineIds.has(v.id))
  );

  const getCategoryProducts = (category: { title: string; handle: string }) => {
    return availableProducts.filter((p) => productMatchesCategory(p, category));
  };

  const categoryList: Array<{ title: string; handle: string }> =
    categories && categories.length > 0
      ? categories.map((c: NormalizedCategory) => ({ title: c.title, handle: c.handle }))
      : [
        { title: "Bra & Panty", handle: "bra-panty" },
        { title: "Nightwear", handle: "nightwear" },
      ];

  const router = useRouter();

  const handleCheckout = () => {
    setIsCartOpen(false);
    router.push(paths.checkout);
  };

  return (
    <Sheet open={isCartOpen} onOpenChange={setIsCartOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          data-source="dynamic" data-source-note="Cart lines and subtotal come from the customer's cart; suggestions from the store's products." data-section="cart-drawer" className="relative hover:opacity-60 transition-opacity text-inherit"
        >
          <ShoppingCart className="size-6 md:size-8" strokeWidth={1.25} />
          {cartCount > 0 && (
            <span className="absolute top-[2px] right-0 md:right-1 bg-[var(--nav-cart-badge-bg)] text-[var(--nav-cart-badge-text)] text-[10px] font-sans font-bold w-[18px] h-[18px] flex items-center justify-center rounded-full">
              {cartCount}
            </span>
          )}
        </Button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="w-full md:w-[450px] bg-[var(--nav-mobile-bg)] text-[var(--nav-mobile-text)] p-0 border-l border-[var(--nav-mobile-border)] flex flex-col [&>button]:hidden"
      >
        <SheetTitle className="sr-only">
          {headerDictionary.cartSrTitle}
        </SheetTitle>

        <div className="flex justify-between items-center px-5 py-3 border-b border-[var(--nav-mobile-border)]">
          <h2 className="font-sans text-[14px] uppercase tracking-[0.15em] font-semibold text-[var(--nav-mobile-text)]">
            YOUR CART ({cartCount})
          </h2>
          <SheetClose className="opacity-70 hover:opacity-100 transition-opacity">
            <X className="w-[22px] h-[22px]" strokeWidth={1.25} />
          </SheetClose>
        </div>

        {cartItems.length > 0 ? (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              <div className="space-y-3">
                {cartItems.map((item) => {
                  const itemUnitPrice = item.numericPrice || parseNumericPrice(item.price);
                  const itemTotalPrice = itemUnitPrice * item.quantity;
                  const isPackItem = Boolean(item.pack);

                  return (
                    <div
                      key={item.lineId}
                      className="flex gap-4 p-5 bg-[var(--nav-mobile-text)]/5 border border-[var(--nav-mobile-text)]/10 rounded-xl items-start relative"
                    >
                      <div className="relative w-25 h-36 bg-[var(--nav-mobile-text)]/10 rounded-md overflow-hidden flex-shrink-0">
                        <Image
                          src={item.image}
                          alt={item.title}
                          fill
                          sizes="80px"
                          className="object-cover"
                        />
                      </div>

                      <div className="flex-1 min-w-0 flex flex-col justify-between h-full">
                        <div>
                          <h3 className="font-sans text-[13px] uppercase tracking-[0.05em] font-medium text-[var(--nav-mobile-text)] truncate pr-2">
                            {item.title}
                          </h3>
                          <p className="text-[11px] text-[var(--nav-mobile-text)]/60 mt-0.5">
                            Size: {item.size || "N/A"} | Color: {item.color || "N/A"}
                          </p>

                          <p className="font-sans text-[22px] font-bold text-[var(--nav-mobile-text)] mt-1">
                            {formatCurrency(itemTotalPrice)}
                          </p>
                        </div>

                        <div className="flex items-center justify-between mt-2 w-full">
                          {isPackItem ? (
                            <span className="inline-flex items-center h-6 px-3 py-3 rounded bg-[var(--nav-mobile-text)] text-[var(--nav-mobile-bg)] text-[11px] font-bold uppercase tracking-[0.08em]">
                              {item.pack}
                            </span>
                          ) : (
                            <div className="flex items-center border border-[var(--nav-mobile-text)]/20 rounded h-8 px-1">
                              <button
                                type="button"
                                onClick={() => updateQuantity(item.lineId, item.quantity - 1)}
                                className="px-2 text-[var(--nav-mobile-text)]/70 hover:text-[var(--nav-mobile-text)]"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <span className="px-2.5 text-[13px] font-semibold">{item.quantity}</span>
                              <button
                                type="button"
                                onClick={() => updateQuantity(item.lineId, item.quantity + 1)}
                                className="px-2 text-[var(--nav-mobile-text)]/70 hover:text-[var(--nav-mobile-text)]"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() => removeFromCart(item.lineId)}
                            className="text-[var(--status-error-text)] hover:text-[var(--status-error-text-hover)] p-1.5 transition-colors"
                            aria-label="Remove item"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="pt-4 px-2 border-t border-[var(--nav-mobile-text)]/10 space-y-5">
                {categoryList.map((category) => (
                  <div key={category.handle} className="space-y-2.5">
                    <h3 className="font-sans text-[11px] uppercase tracking-[0.15em] font-semibold text-[var(--nav-mobile-text)]/80">
                      BROWSE {category.title}
                    </h3>

                    <CartCategoryCarousel
                      products={getCategoryProducts(category)}
                      onItemClick={() => setIsCartOpen(false)}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 border-t border-[var(--nav-mobile-border)] bg-[var(--nav-mobile-bg)]/80 space-y-3">
              <p className="text-[10px] text-center font-sans tracking-[0.05em] text-[var(--nav-mobile-text)]/60 border-b border-[var(--nav-mobile-text)]/10 pb-2">
                Delivery charges and taxes will be calculated at checkout
              </p>

              <div className="flex justify-between items-center text-[15px] font-sans uppercase tracking-[0.1em]">
                <span className="text-[var(--nav-mobile-text)]/80 font-medium">SUBTOTAL</span>
                <span className="font-bold text-[var(--nav-mobile-text)] text-[28px]">
                  {formatCurrency(subtotal)}
                </span>
              </div>

              <Button
                type="button"
                onClick={handleCheckout}
                className="w-full h-11 bg-[var(--nav-mobile-text)] text-[var(--nav-mobile-bg)] font-sans text-[12px] uppercase tracking-[0.15em] font-bold rounded-lg hover:bg-[var(--nav-mobile-text)]/90 transition-all"
              >
                PROCEED TO CHECKOUT
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto flex flex-col justify-between p-6">
            <div className="flex flex-col gap-2 justify-center items-center py-6">
              <h3 className="font-sans text-[20px] uppercase tracking-[0.1em] text-[var(--nav-mobile-text)]">
                {headerDictionary.cartEmptyHeading}
              </h3>
              <p className="text-center text-[var(--nav-mobile-muted)] font-sans text-[14px]">
                {headerDictionary.cartEmptyHelperLine1}
                <br />
                {headerDictionary.cartEmptyHelperLine2}
              </p>
            </div>

            <div className="pt-6 px-2 border-t border-[var(--nav-mobile-text)]/10 space-y-5 mt-auto">
              {categoryList.map((category) => (
                <div key={category.handle} className="space-y-2.5">
                  <h3 className="font-sans text-[11px] uppercase tracking-[0.15em] font-semibold text-[var(--nav-mobile-text)]/80">
                    BROWSE {category.title}
                  </h3>

                  <CartCategoryCarousel
                    products={getCategoryProducts(category)}
                    onItemClick={() => setIsCartOpen(false)}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}