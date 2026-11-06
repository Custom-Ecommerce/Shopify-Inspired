"use client";

import React, { createContext, useContext, useMemo, useState } from "react";
import type { UIContextValue } from "../../types";

const noop = () => {
  /* no-op default, overridden by UIProvider */
};

const defaultUIContextValue: UIContextValue = {
  isMobileMenuOpen: false,
  setMobileMenuOpen: noop,
  isSearchOpen: false,
  setSearchOpen: noop,
  isCartOpen: false,
  setCartOpen: noop,
  cartCount: 0,
  setCartCount: noop,
};

const UIContext = createContext<UIContextValue>(defaultUIContextValue);

export interface UIProviderProps {
  children: React.ReactNode;
  initialCartCount?: number;
}

/**
 * Optional provider for consuming apps that want centralized control over
 * the mobile menu / search drawer / cart drawer open-state (e.g. to open the
 * cart drawer from an "Add to cart" action elsewhere on the page).
 *
 * Components in this package read sensible defaults from context even when
 * no provider is mounted, so wrapping the app in `UIProvider` is optional.
 */
export function UIProvider({ children, initialCartCount = 0 }: UIProviderProps) {
  const [isMobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isSearchOpen, setSearchOpen] = useState(false);
  const [isCartOpen, setCartOpen] = useState(false);
  const [cartCount, setCartCount] = useState(initialCartCount);

  const value = useMemo<UIContextValue>(
    () => ({
      isMobileMenuOpen,
      setMobileMenuOpen,
      isSearchOpen,
      setSearchOpen,
      isCartOpen,
      setCartOpen,
      cartCount,
      setCartCount,
    }),
    [isMobileMenuOpen, isSearchOpen, isCartOpen, cartCount]
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUIContext(): UIContextValue {
  return useContext(UIContext);
}
