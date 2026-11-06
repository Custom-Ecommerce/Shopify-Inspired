"use client";

import React, { createContext, useContext, useMemo } from 'react';

export interface TenantSnapshot {
  tenantKind: 'tenant' | 'demo' | 'custom';
  storeId: string;
  slug: string;
  internalHandle: string;
  storeName: string;
  storeStatus: 'active' | 'pending' | 'suspended' | 'archived';
  checkoutEnabled: boolean;
  noindex: boolean;
  effectiveTheme: {
    slug: string;
    source: 'store' | 'default' | 'demo';
    fallbackReason?: string;
  };
  commerce: {
    currency: string;
    locale: string;
    codEnabled: boolean;
    cardEnabled: boolean;
    deliveryRate: number;
    freeDeliveryThreshold: number;
    whatsappNumber?: string | null;
  };
  branding: {
    logoUrl?: string | null;
    announcementText?: string | null;
    socialProofEnabled: boolean;
  };
}

const TenantContext = createContext<TenantSnapshot | undefined>(undefined);

export function TenantProvider({
  value,
  children,
}: {
  value: TenantSnapshot;
  children: React.ReactNode;
}) {
  // The snapshot is built once per request by the tenant layout, so its identity
  // is already stable; keying the memo on the object itself keeps lint exact.
  const memoizedValue = useMemo(() => value, [value]);

  return (
    <TenantContext.Provider value={memoizedValue}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant(): TenantSnapshot {
  const context = useContext(TenantContext);
  if (context === undefined) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return context;
}
