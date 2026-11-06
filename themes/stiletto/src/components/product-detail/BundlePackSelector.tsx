"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { paths } from "../../adapters/paths";

export interface PackOption {
  quantity: number;
  label: string;
  discountPercentage: number;
  isPopular?: boolean;
}

export interface SelectedBundleItem {
  pieceNumber: number;
  size: string;
  color: string;
  lineId?: string;
}

export interface ProductVariant {
  id: string;
  title: string;
  availableForSale: boolean;
  price: {
    amount: string;
  };
  selectedOptions: Array<{
    name: string;
    value: string;
  }>;
}

const PACK_OPTIONS: PackOption[] = [
  { quantity: 1, label: "Pack of 1", discountPercentage: 0 },
  { quantity: 2, label: "Pack of 2", discountPercentage: 5 },
  { quantity: 3, label: "Pack of 3", discountPercentage: 10, isPopular: true },
  { quantity: 4, label: "Pack of 4", discountPercentage: 15 },
  { quantity: 5, label: "Pack of 5", discountPercentage: 20 },
];

interface BundlePackSelectorProps {
  basePrice: number;
  availableSizes: string[];
  availableColors: string[];
  variants: ProductVariant[];
  totalStock?: number;
}

export function BundlePackSelector({
  basePrice,
  availableSizes,
  availableColors,
  variants,
  totalStock = 300,
}: BundlePackSelectorProps) {
  const router = useRouter();

  // Selected Pack State (Default Pack of 3)
  const [selectedPackCount, setSelectedPackCount] = useState<number>(3);

  // Dynamic state for each piece in the selected pack
  const [bundleItems, setBundleItems] = useState<SelectedBundleItem[]>(() =>
    Array.from({ length: 3 }, (_, index) => ({
      pieceNumber: index + 1,
      size: "",
      color: "",
    }))
  );

  // Switch Pack Tabs (1 to 5)
  const handlePackChange = (count: number) => {
    setSelectedPackCount(count);
    setBundleItems(
      Array.from({ length: count }, (_, index) => ({
        pieceNumber: index + 1,
        size: "",
        color: "",
      }))
    );
  };

  // Handle individual piece selection and map directly to store variant ID
  const handleItemSelect = (
    index: number,
    field: "size" | "color",
    value: string
  ) => {
    const updated = [...bundleItems];
    updated[index] = { ...updated[index], [field]: value };

    // Find matching variant from your store JSON options array
    if (updated[index].size && updated[index].color) {
      const match = variants.find((v) => {
        const sizeOpt = v.selectedOptions.find(
          (opt) => opt.name.toLowerCase() === "size"
        )?.value;
        const colorOpt = v.selectedOptions.find(
          (opt) => opt.name.toLowerCase() === "color"
        )?.value;

        return (
          sizeOpt === updated[index].size && colorOpt === updated[index].color
        );
      });

      if (match) {
        updated[index].lineId = match.id;
      }
    }

    setBundleItems(updated);
  };

  // Pricing Matrix Calculation
  const activePackConfig = useMemo(
    () =>
      PACK_OPTIONS.find((p) => p.quantity === selectedPackCount) ||
      PACK_OPTIONS[0],
    [selectedPackCount]
  );

  const rawTotalPrice = basePrice * selectedPackCount;
  const discountedPrice =
    rawTotalPrice * (1 - activePackConfig.discountPercentage / 100);

  // Guard: Confirm ALL items have both Size & Color selected
  const isBundleComplete = useMemo(() => {
    return (
      bundleItems.length === selectedPackCount &&
      bundleItems.every(
        (item) => item.size !== "" && item.color !== "" && item.lineId
      )
    );
  }, [bundleItems, selectedPackCount]);

  // Direct Checkout Payload Handler
  const handleBuyNow = () => {
    if (!isBundleComplete) return;

    const payloadString = encodeURIComponent(JSON.stringify(bundleItems));
    router.push(
      `${paths.checkout}?bundle=${payloadString}&pack=${selectedPackCount}&total=${Math.round(
        discountedPrice
      )}`
    );
  };

  return (
    <div className="space-y-6 border-t border-[var(--separator-border)] pt-4">
      {/* Dynamic Stock Badge */}
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--stock-indicator-text)]">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--stock-indicator-ping)] opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[var(--stock-indicator-dot)]"></span>
        </span>
        ⚡ {totalStock} PIECES LEFT IN STOCK
      </div>

      {/* Pricing Header */}
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-extrabold text-[var(--text-primary)]">
          Rs. {Math.round(discountedPrice).toLocaleString("en-PK")}
        </span>
        {activePackConfig.discountPercentage > 0 && (
          <span className="text-sm text-[var(--form-disabled-text)] line-through">
            Rs. {rawTotalPrice.toLocaleString("en-PK")}
          </span>
        )}
        {activePackConfig.discountPercentage > 0 && (
          <span className="rounded bg-[var(--discount-badge-bg)] px-2 py-0.5 text-xs font-bold text-[var(--discount-badge-text)]">
            SAVE {activePackConfig.discountPercentage}%
          </span>
        )}
      </div>

      {/* 1. Pack Tabs (Pack of 1 to 5) */}
      <div>
        <label className="block text-xs font-bold uppercase tracking-wide text-[var(--form-label-text)] mb-2">
          1. Select Pack Size:
        </label>
        <div className="grid grid-cols-5 gap-1.5">
          {PACK_OPTIONS.map((pack) => (
            <button
              key={pack.quantity}
              type="button"
              onClick={() => handlePackChange(pack.quantity)}
              className={`relative flex flex-col items-center justify-center rounded border py-2 text-xs font-bold transition-all ${
                selectedPackCount === pack.quantity
                  ? "border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[var(--text-inverse)] shadow-md"
                  : "border-[var(--form-border)] bg-[var(--surface-elevated)] text-[var(--form-input-text)] hover:border-[var(--form-border-hover)]"
              }`}
            >
              {pack.isPopular && (
                <span className="absolute -top-2.5 rounded bg-[var(--popular-badge-bg)] px-1 text-[8px] font-black uppercase text-[var(--text-primary)]">
                  POPULAR
                </span>
              )}
              <span>{pack.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 2. Dynamic Mix & Match Controls */}
      <div className="space-y-3">
        <label className="block text-xs font-bold uppercase tracking-wide text-[var(--form-label-text)]">
          2. Choose Size & Color for each piece ({selectedPackCount}):
        </label>

        {bundleItems.map((item, index) => (
          <div
            key={index}
            className="rounded border border-[var(--separator-border)] bg-[var(--surface-muted)]/70 p-3 space-y-2"
          >
            <div className="text-xs font-bold text-[var(--form-label-text)] uppercase">
              Piece #{item.pieceNumber} Selection
            </div>

            <div className="grid grid-cols-2 gap-2">
              {/* Size Select */}
              <select
                value={item.size}
                onChange={(e) => handleItemSelect(index, "size", e.target.value)}
                className="w-full rounded border border-[var(--form-border)] bg-[var(--surface-elevated)] p-2 text-xs font-semibold text-[var(--form-input-text)] focus:border-[var(--brand-primary)] focus:outline-none"
              >
                <option value="">Select Size</option>
                {availableSizes.map((size) => (
                  <option key={size} value={size}>
                    Size: {size}
                  </option>
                ))}
              </select>

              {/* Color Select */}
              <select
                value={item.color}
                onChange={(e) => handleItemSelect(index, "color", e.target.value)}
                className="w-full rounded border border-[var(--form-border)] bg-[var(--surface-elevated)] p-2 text-xs font-semibold text-[var(--form-input-text)] focus:border-[var(--brand-primary)] focus:outline-none"
              >
                <option value="">Select Color</option>
                {availableColors.map((color) => (
                  <option key={color} value={color}>
                    Color: {color}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>

      {/* 3. Direct Buy Now CTA */}
      <div className="pt-2">
        <button
          type="button"
          onClick={handleBuyNow}
          disabled={!isBundleComplete}
          className={`w-full rounded py-3 text-sm font-bold uppercase tracking-wider transition-all ${
            isBundleComplete
              ? "bg-[var(--brand-primary)] text-[var(--text-inverse)] hover:bg-[var(--cta-hover-bg)] shadow-lg cursor-pointer"
              : "bg-[var(--form-disabled-bg)] text-[var(--form-disabled-text)] cursor-not-allowed opacity-60"
          }`}
        >
          {isBundleComplete ? "BUY NOW (DIRECT CHECKOUT)" : "SELECT ALL SIZES & COLORS TO CONTINUE"}
        </button>
      </div>
    </div>
  );
}