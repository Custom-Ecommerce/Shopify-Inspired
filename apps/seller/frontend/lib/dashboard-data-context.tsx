"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface CacheEntry {
  data: any;
  timestamp: number;
}

interface DashboardDataContextType {
  cache: Record<string, CacheEntry>;
  setCacheData: (key: string, data: any) => void;
  refreshTrigger: number;
  refresh: () => void;
  isRefreshing: boolean;
  setIsRefreshing: (val: boolean) => void;
}

const DashboardDataContext = createContext<DashboardDataContextType | undefined>(undefined);

export function DashboardDataProvider({ children }: { children: ReactNode }) {
  const [cache, setCache] = useState<Record<string, CacheEntry>>({});
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const setCacheData = useCallback((key: string, data: any) => {
    setCache((prev) => ({ ...prev, [key]: { data, timestamp: Date.now() } }));
  }, []);

  const refresh = useCallback(() => {
    setRefreshTrigger((prev) => prev + 1);
  }, []);

  return (
    <DashboardDataContext.Provider
      value={{
        cache,
        setCacheData,
        refreshTrigger,
        refresh,
        isRefreshing,
        setIsRefreshing,
      }}
    >
      {children}
    </DashboardDataContext.Provider>
  );
}

export function useDashboardData() {
  const context = useContext(DashboardDataContext);
  if (context === undefined) {
    throw new Error("useDashboardData must be used within a DashboardDataProvider");
  }
  return context;
}
