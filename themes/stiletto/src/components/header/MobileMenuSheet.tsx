import { ChevronRight, Menu, Search, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { headerDictionary } from "../../shared/constants/dictionary";
import type { MobileMenuSheetProps } from "../../types";
import { Button } from "../../shared/components/primitives/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "../../shared/components/primitives/sheet";
import { BrandDisplay } from "../../components/brand/BrandDisplay";



export function MobileMenuSheet({ brand, menuLogo, navLinks }: MobileMenuSheetProps) {
  const displayBrand = {
    ...brand,
    logo: menuLogo || brand.logo
  };
  return (
    <div data-source="partial" data-source-note="Menu entries come from the store's categories; the rest is theme text." data-section="mobile-menu" className="md:hidden mr-4">
      <Sheet>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="hover:opacity-60 transition-opacity text-inherit"
          >
            <Menu className="size-6 md:size-8" strokeWidth={1.25} />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="left"
          className="w-full sm:w-[350px] bg-[var(--nav-mobile-bg)] text-[var(--nav-mobile-text)] p-0 border-r border-[var(--nav-mobile-border)] [&>button]:hidden"
        >
          <SheetTitle className="sr-only">
            {headerDictionary.mobileMenuTitle}
          </SheetTitle>

          <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--nav-mobile-border)]">
            <BrandDisplay
              brand={displayBrand}
              className="h-15 w-24" // Mobile menu header ke liye height/width
            />
            <div className="flex items-center gap-4">
              <Search className="w-[22px] h-[22px]" strokeWidth={1.25} />
              <SheetClose className="opacity-70 hover:opacity-100 transition-opacity">
                <X className="w-[26px] h-[26px]" strokeWidth={1.25} />
              </SheetClose>
            </div>
          </div>

          <div className="flex flex-col px-4 py-2 overflow-y-auto h-full pb-32">
            {navLinks.map((link, idx) => (
              <Link
                key={`${link.label}-${idx}`}
                href={link.href}
                className="flex items-center justify-between py-4 border-b border-[var(--nav-mobile-border)] group"
              >
                <div className="flex items-center gap-4">
                  <div className="relative w-[60px] h-[60px] bg-[var(--nav-mobile-thumb-bg)] overflow-hidden rounded-md shrink-0">
                    {link.image && (
                      <Image
                        src={link.image}
                        alt={link.label}
                        fill
                        sizes="60px"
                        className="object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    )}
                  </div>
                  <span className="font-sans text-[14px] font-semibold uppercase tracking-widest text-[var(--nav-mobile-text)] group-hover:opacity-70 transition-opacity">
                    {link.label}
                  </span>
                </div>
                <ChevronRight className="w-4 h-4 opacity-50 text-[var(--nav-mobile-text)]" />
              </Link>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
