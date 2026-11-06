// ============================================================================
// Shared barrel — generic, theme-agnostic building blocks usable by any
// theme (primitives, hooks, context, lib, constants).
// ============================================================================

export * from "./components/primitives/button";
export * from "./components/primitives/input";
export * from "./components/primitives/card";
export * from "./components/primitives/sheet";
export * from "./components/product/ProductCard";

export * from "./components/watermark/WatermarkBackground";

export * from "./hooks/useCarouselScroll";
export * from "./hooks/useAutoRotate";
export * from "./hooks/useCountdown";
export * from "./hooks/useScrollState";

export * from "./context/UIContext";
export * from "./context/StoreDataContext";
export * from "./context/CartContext";

export * from "./lib/utils";
export * from "./lib/animations";
export * from "./lib/productCategoryMatch";

export * from "./constants/dictionary";
