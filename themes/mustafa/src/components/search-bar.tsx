"use client";

import { useId } from "react";
import Form from "next/form";
import { MAX_SEARCH_LENGTH, storePaths } from "@markaz/storefront-data";
import { Input } from "./ui/input";
import { cn } from "./ui/cn";
import { SearchIcon } from "./ui/icons";

export interface SearchBarProps {
  defaultValue?: string;
  className?: string;
}

/**
 * The store's product search. It is a GET form to the search page, so the query sits in the address bar, the results
 * page can be shared, and the search works before scripts have loaded. Next's Form keeps the navigation on the client.
 */
export function SearchBar({ defaultValue = "", className }: SearchBarProps) {
  const inputId = useId();
  return (
    <Form action={storePaths.search} role="search" className={cn("flex w-full items-center gap-2", className)}>
      <label htmlFor={inputId} className="sr-only">
        Search products
      </label>
      <Input
        id={inputId}
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder="Search products"
        autoComplete="off"
        enterKeyHint="search"
        maxLength={MAX_SEARCH_LENGTH}
        required
        className="h-11 min-w-0 flex-1"
      />
      <button
        type="submit"
        aria-label="Search"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-(--mu-radius) bg-(--mu-primary) text-(color:--mu-primary-fg) transition-colors hover:bg-(--mu-primary-hover) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(color:--mu-focus)"
      >
        <SearchIcon />
      </button>
    </Form>
  );
}
