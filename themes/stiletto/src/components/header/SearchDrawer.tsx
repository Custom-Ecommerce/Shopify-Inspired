import React from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "../../shared/components/primitives/sheet";
import { Button } from "../../shared/components/primitives/button";
import { Input } from "../../shared/components/primitives/input";
import { headerDictionary } from "../../shared/constants/dictionary";
import type { SearchDrawerData } from "../../types";
import { paths } from "../../adapters/paths";

export interface SearchDrawerProps {
  data?: SearchDrawerData;
}

export function SearchDrawer({ data }: SearchDrawerProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          data-source="partial" data-source-note="Popular collections come from the store's categories. The search box does not search in the source design." data-section="search-drawer" className="hover:opacity-60 transition-opacity text-inherit"
        >
          <Search className="size-6 md:size-8" strokeWidth={1.25} />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full md:w-[450px] bg-[var(--nav-mobile-bg)] text-[var(--nav-mobile-text)] p-8 border-l border-[var(--nav-mobile-border)]"
      >
        <SheetTitle className="sr-only">{headerDictionary.searchTitle}</SheetTitle>
        <div className="flex justify-between items-center mb-8 border-b border-[var(--nav-mobile-border)] pb-4 mt-8">
          <div className="flex items-center gap-4 w-full">
            <Search className="w-[26px] h-[26px] opacity-70" strokeWidth={1.25} />
            <Input
              type="text"
              placeholder={headerDictionary.searchPlaceholder}
              className="border-none bg-transparent outline-none w-full font-sans text-xl shadow-none h-auto px-0 placeholder:text-[var(--nav-mobile-muted)] focus-visible:ring-0"
            />
          </div>
        </div>
        <div>
          <h4 className="font-sans text-[14px] text-[var(--nav-mobile-muted)] mb-6">
            {headerDictionary.popularCollectionsLabel}
          </h4>
          <div className="flex flex-col gap-4">
            {data?.popularCollections.map((collection) => (
              <Link
                key={collection}
                href={paths.searchFor(collection)}
                className="font-sans text-[16px] text-[var(--nav-mobile-text)] hover:opacity-60 transition-opacity"
              >
                {collection}
              </Link>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
