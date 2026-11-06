"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { NotFoundPageProps, UnavailablePageProps } from "@markaz/storefront-data";

type States = { Unavailable: ComponentType<UnavailablePageProps>; NotFound: ComponentType<NotFoundPageProps> };

// Error and not-found boundaries are client components, so they cannot await the server registry. Each theme's states load on demand.
const STATES: Record<string, States> = {
  mustafa: {
    Unavailable: dynamic(() => import("@markaz/theme-mustafa").then((m) => m.UnavailablePage)),
    NotFound: dynamic(() => import("@markaz/theme-mustafa").then((m) => m.NotFoundPage)),
  },
  stiletto: {
    Unavailable: dynamic(() => import("@markaz/theme-stiletto").then((m) => m.UnavailablePage)),
    NotFound: dynamic(() => import("@markaz/theme-stiletto").then((m) => m.NotFoundPage)),
  },
};

function statesFor(slug: string): States {
  return STATES[slug] ?? STATES.mustafa;
}

export function ThemedUnavailable({ slug, ...props }: UnavailablePageProps & { slug: string }) {
  const { Unavailable } = statesFor(slug);
  return <Unavailable {...props} />;
}

export function ThemedNotFound({ slug }: { slug: string }) {
  const { NotFound } = statesFor(slug);
  return <NotFound />;
}
