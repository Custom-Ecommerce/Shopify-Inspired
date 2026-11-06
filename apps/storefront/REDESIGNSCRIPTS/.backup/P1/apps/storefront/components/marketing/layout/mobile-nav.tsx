"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { BrandMark } from "@/components/shared/brand-mark";
import { navLinks } from "@/content/marketing/nav";
import { getSellerPortalUrl } from "@/lib/urls";

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="ghost" className="min-h-11 min-w-11 shrink-0 px-2 lg:hidden" aria-label="Open menu" />}>
        <Menu className="size-6" aria-hidden="true" />
      </SheetTrigger>
      <SheetContent side="right" className="flex flex-col border-border bg-background px-6 pt-10">
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation Menu</SheetTitle>
        </SheetHeader>
        <div className="mb-8">
          <BrandMark onClick={() => setOpen(false)} />
        </div>
        <nav aria-label="Mobile navigation" className="flex flex-col gap-4">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex min-h-12 items-center text-lg font-medium text-foreground transition-colors hover:text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-md px-2"
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-3 pb-12">
          <Button
            asChild
            variant="ghost"
            className="min-h-12 justify-start px-2 text-base font-medium"
          >
            <a href={getSellerPortalUrl("login")} onClick={() => setOpen(false)}>
              Log in
            </a>
          </Button>
          <Button
            asChild
            className="min-h-12 w-full text-base font-semibold"
          >
            <a href={getSellerPortalUrl("signup")} onClick={() => setOpen(false)}>
              Start free
            </a>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
