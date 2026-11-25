"use client";

import { useLayoutEffect } from "react";

/**
 * Applies the same scope as ThemeScope's inline script, from React. A store page that calls notFound() is rendered in the
 * browser, where an inline script React inserts never runs: without this the 404 page had none of the theme's styles.
 */
export function ThemeScopeApply({ slug, classes }: { slug: string; classes: string[] }) {
  const joined = classes.join(" ");
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.setAttribute("data-theme", slug);
    html.classList.add(...joined.split(" ").filter(Boolean));
  }, [slug, joined]);
  return null;
}
