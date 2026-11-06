"use client";

import { useRef } from "react";
import Link from "next/link";
import type { NavLinkVM } from "@markaz/storefront-data";
import { CloseIcon, MenuIcon } from "./ui/icons";

export interface MobileNavProps {
  links: NavLinkVM[];
  storeName: string;
}

/**
 * Phone navigation in a native modal dialog. The browser handles Escape, keeps focus inside the panel while it
 * is open, and makes the page behind it inert. A click on the dimmed area closes it.
 */
export function MobileNav({ links, storeName }: MobileNavProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  function open() {
    dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label="Open menu"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-(--mu-radius) text-(color:--mu-fg) transition-colors hover:bg-(--mu-surface-muted) active:bg-(--mu-border) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--mu-focus) md:hidden"
      >
        <MenuIcon />
      </button>
      <dialog
        ref={dialogRef}
        aria-label="Menu"
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        className="my-0 ms-auto me-0 h-dvh max-h-none w-[min(20rem,88vw)] max-w-none border-0 bg-(--mu-surface) p-0 text-(color:--mu-fg) shadow-(--mu-shadow-md) backdrop:bg-(--mu-overlay) open:flex open:flex-col"
      >
        <div className="flex items-center justify-between gap-3 border-b border-(--mu-border) px-4 py-3">
          <span className="min-w-0 truncate font-semibold tracking-tight">{storeName}</span>
          <button
            type="button"
            onClick={close}
            aria-label="Close menu"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-(--mu-radius) transition-colors hover:bg-(--mu-surface-muted) active:bg-(--mu-border) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--mu-focus)"
          >
            <CloseIcon />
          </button>
        </div>
        <nav aria-label="Mobile" className="flex flex-col gap-1 overflow-y-auto p-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={close}
              className="rounded-(--mu-radius) px-3 py-3 text-base font-medium transition-colors hover:bg-(--mu-surface-muted) active:bg-(--mu-border)"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </dialog>
    </>
  );
}
