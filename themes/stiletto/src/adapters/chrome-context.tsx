"use client";

import { createContext, useContext } from "react";
import type { NormalizedCategory, StoreData } from "../model";
import type { StilettoContent } from "../content";

export interface StilettoChrome {
  store: StoreData;
  content: StilettoContent;
  categories: NormalizedCategory[];
}

const ChromeContext = createContext<StilettoChrome | null>(null);

export const StilettoChromeProvider = ChromeContext.Provider;

export function useStilettoChrome(): StilettoChrome {
  const value = useContext(ChromeContext);
  if (!value) throw new Error("useStilettoChrome must be used inside the Stiletto Layout");
  return value;
}
