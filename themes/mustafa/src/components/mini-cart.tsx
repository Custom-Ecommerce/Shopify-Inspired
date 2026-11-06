"use client";

import { useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { storePaths } from "@markaz/storefront-data";
import { useCart } from "@markaz/storefront-data/client";
import { countLabel } from "../lib/text";
import { QtyStepper } from "./qty-stepper";
import { Button, buttonVariants } from "./ui/button";
import { CartIcon, CloseIcon } from "./ui/icons";
import { Spinner } from "./ui/spinner";

const TRIGGER =
  "relative inline-flex h-11 shrink-0 items-center gap-2 rounded-(--mu-radius) px-3 text-sm font-medium text-(color:--mu-fg) transition-colors hover:bg-(--mu-surface-muted) active:bg-(--mu-border) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--mu-focus)";

const ICON_BUTTON =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-(--mu-radius) transition-colors hover:bg-(--mu-surface-muted) active:bg-(--mu-border) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--mu-focus)";

/**
 * The header's cart button and a side drawer that lists the cart. Quantities and removals apply at once. The drawer links
 * to the full cart, where checkout checks stock and prices. It is a native dialog, so Escape, focus containment and the
 * inert page behind it come from the browser.
 */
export function MiniCart() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { lines, itemCount, subtotal, isEmpty, isHydrated, setQty, remove } = useCart();
  const count = isHydrated ? itemCount : 0;
  const label = count > 0 ? "Cart, " + countLabel(count, "item", "items") : "Cart";

  function open() {
    dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button type="button" onClick={open} aria-label={label} className={TRIGGER}>
        <CartIcon />
        <span className="hidden sm:inline">Cart</span>
        {count > 0 ? (
          <span
            aria-hidden="true"
            className="flex h-5 min-w-5 items-center justify-center rounded-full bg-(--mu-primary) px-1.5 text-xs font-semibold tabular-nums text-(color:--mu-primary-fg)"
          >
            {count}
          </span>
        ) : null}
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="mini-cart-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        className="my-0 ms-auto me-0 flex h-dvh max-h-none w-[min(24rem,92vw)] max-w-none flex-col border-0 bg-(--mu-surface) p-0 text-(color:--mu-fg) shadow-(--mu-shadow-md) backdrop:bg-(--mu-overlay) open:flex"
      >
        <div className="flex items-center justify-between gap-3 border-b border-(--mu-border) px-4 py-3">
          <h2 id="mini-cart-title" className="text-base font-semibold">
            {isHydrated && count > 0 ? "Your cart (" + count + ")" : "Your cart"}
          </h2>
          <button type="button" onClick={close} aria-label="Close cart" className={ICON_BUTTON}>
            <CloseIcon />
          </button>
        </div>

        {!isHydrated ? (
          <p role="status" className="flex items-center gap-2 p-4 text-sm text-(color:--mu-fg-muted)">
            <Spinner />
            Loading your cart
          </p>
        ) : isEmpty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
            <p className="text-(color:--mu-fg-muted)">Your cart is empty.</p>
            <Link href={storePaths.catalog} onClick={close} className={buttonVariants({ variant: "secondary" })}>
              Continue shopping
            </Link>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-(--mu-border) overflow-y-auto px-4">
              {lines.map((item) => (
                <li key={item.id} className="flex gap-3 py-4">
                  <div className="relative size-16 shrink-0 overflow-hidden rounded-(--mu-radius) border border-(--mu-border) bg-(--mu-surface-muted)">
                    {item.image ? <Image src={item.image.url} alt="" fill sizes="64px" className="object-cover" /> : null}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <Link
                      href={storePaths.product(item.slug)}
                      onClick={close}
                      className="line-clamp-2 text-sm leading-snug font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--mu-focus)"
                    >
                      {item.title}
                    </Link>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <QtyStepper label={item.title} qty={item.qty} onChange={(qty) => setQty(item.id, qty)} />
                      <span className="text-sm font-semibold tabular-nums">{item.lineTotal.formatted}</span>
                    </div>
                    <div className="flex justify-end">
                      <Button variant="danger" size="sm" onClick={() => remove(item.id)}>
                        Remove
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex flex-col gap-3 border-t border-(--mu-border) p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-(color:--mu-fg-muted)">Subtotal</span>
                <span className="font-semibold tabular-nums">{subtotal.formatted}</span>
              </div>
              <Link href={storePaths.cart} onClick={close} className={buttonVariants({ size: "lg", fullWidth: true })}>
                View cart
              </Link>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
