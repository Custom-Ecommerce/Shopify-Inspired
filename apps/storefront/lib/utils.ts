import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Class merge helper for the whole storefront. It is built on tailwind-merge rather than the npm
 * "cn" package, because "cn" read our type tokens (text-h2, text-lead ...) as colours and dropped
 * them whenever a text colour was merged in the same call. The font-size names below must match
 * the --text-* tokens in app/globals.css.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["display", "h1", "h2", "h2-sm", "h3", "lead", "body"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
