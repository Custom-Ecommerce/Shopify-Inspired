"use client";

import React, { createContext, useContext, useMemo } from "react";
import type { NormalizedCategory, NormalizedProduct, StoreData } from "../../types";

export interface StoreDataValue {
  categories: NormalizedCategory[];
  products: NormalizedProduct[];
  store?: StoreData;
}

const StoreDataContext = createContext<StoreDataValue>({
  categories: [],
  products: [],
  store: undefined,
});

export interface StoreDataProviderProps extends StoreDataValue {
  children: React.ReactNode;
}

export function StoreDataProvider({ categories, products, store, children }: StoreDataProviderProps) {
  const value = useMemo<StoreDataValue>(
    () => ({ categories, products, store }),
    [categories, products, store]
  );

  return <StoreDataContext.Provider value={value}>{children}</StoreDataContext.Provider>;
}

export function useStoreData(): StoreDataValue {
  return useContext(StoreDataContext);
}