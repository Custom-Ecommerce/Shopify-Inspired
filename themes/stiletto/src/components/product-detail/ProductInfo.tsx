"use client";

import React, { useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { useCartContext } from "../../shared/context/CartContext";
import type { NormalizedProduct } from "../../types";

interface ProductInfoProps {
  product: NormalizedProduct;
}

const MAX_QUANTITY = 10;

export function ProductInfo({ product }: ProductInfoProps) {
  const { addToCart } = useCartContext();

  const packOption = product.packOption ?? null;
  const hasPackOption = Boolean(product.hasPackOption && packOption && packOption.values.length > 0);
  const packOptionName = packOption?.name || "Pack";
  const packValues = useMemo(() => (hasPackOption ? packOption!.values : []), [hasPackOption, packOption]);

  const sizeOptions = useMemo(() => {
    const opt = product.options?.find((o) => o.name.toLowerCase() === "size");
    return opt?.values || product.sizes || [];
  }, [product.options, product.sizes]);

  const colorOptions = useMemo(() => {
    const opt = product.options?.find((o) => o.name.toLowerCase() === "color");
    return opt?.values || product.colors || [];
  }, [product.options, product.colors]);

  const [selectedPack, setSelectedPack] = useState<string>(packValues[0] || "");
  const [selectedSize, setSelectedSize] = useState<string>(sizeOptions[0] || "");
  const [selectedColor, setSelectedColor] = useState<string>(colorOptions[0] || "");
  const [customColorNote, setCustomColorNote] = useState<string>("");

  const [quantity, setQuantity] = useState<number>(1);

  const incrementQuantity = () => setQuantity((q) => Math.min(MAX_QUANTITY, q + 1));
  const decrementQuantity = () => setQuantity((q) => Math.max(1, q - 1));

  const matchedVariant = useMemo(() => {
    if (!product.variants || product.variants.length === 0) return null;

    return (
      product.variants.find((v) => {
        const titleUpper = v.title.toUpperCase();

        const matchesPack =
          !hasPackOption ||
          !selectedPack ||
          v.selectedOptions?.some((o) => o.value.toLowerCase() === selectedPack.toLowerCase()) ||
          titleUpper.includes(selectedPack.toUpperCase());

        const matchesSize =
          !selectedSize ||
          v.selectedOptions?.some((o) => o.value.toLowerCase() === selectedSize.toLowerCase()) ||
          titleUpper.includes(selectedSize.toUpperCase());

        const matchesColor =
          !selectedColor ||
          v.selectedOptions?.some((o) => o.value.toLowerCase() === selectedColor.toLowerCase()) ||
          titleUpper.includes(selectedColor.toUpperCase());

        return matchesPack && matchesSize && matchesColor;
      }) || product.variants[0]
    );
  }, [product.variants, hasPackOption, selectedPack, selectedSize, selectedColor]);

  const displayPriceNumber = useMemo(() => {
    if (matchedVariant?.price?.amount) {
      const num = parseFloat(String(matchedVariant.price.amount));
      return isNaN(num) ? 2500 : num;
    }

    const raw = String(product.price || "2500");
    const cleanDigits = raw.replace(/[^0-9]/g, "");
    const parsed = parseInt(cleanDigits, 10);

    if (parsed > 100000) return parsed / 100;
    return parsed || 2500;
  }, [matchedVariant, product.price]);

  const displayPrice = useMemo(
    () => displayPriceNumber.toLocaleString("en-PK"),
    [displayPriceNumber]
  );

  const compareAtPriceNumber = useMemo(() => {
    const raw = matchedVariant?.compareAtPrice?.amount;
    if (raw == null) return null;

    const num = parseFloat(String(raw));
    if (isNaN(num) || num <= displayPriceNumber) return null;

    return num;
  }, [matchedVariant, displayPriceNumber]);

  const hasDiscount = compareAtPriceNumber !== null;

  const discountPercent = useMemo(() => {
    if (!hasDiscount || compareAtPriceNumber === null) return 0;
    return Math.round(((compareAtPriceNumber - displayPriceNumber) / compareAtPriceNumber) * 100);
  }, [hasDiscount, compareAtPriceNumber, displayPriceNumber]);

  const displayCompareAtPrice = useMemo(
    () => (compareAtPriceNumber !== null ? compareAtPriceNumber.toLocaleString("en-PK") : ""),
    [compareAtPriceNumber]
  );

  const handleAddToCart = () => {
    if (!matchedVariant) return;

    const finalPrice = matchedVariant.price?.amount
      ? String(matchedVariant.price.amount)
      : String(product.price).replace(/[^0-9]/g, "");

    const packSelectedOption = hasPackOption
      ? matchedVariant.selectedOptions?.find((o) => o.name.toLowerCase() === packOptionName.toLowerCase())
      : undefined;

    addToCart({
      lineId: matchedVariant.id,
      handle: product.handle,
      title: hasPackOption ? `${product.title} (${selectedPack})` : product.title,
      size: selectedSize,
      color: customColorNote
        ? `${selectedColor} [Note: ${customColorNote}]`
        : selectedColor,
      pack: hasPackOption ? (packSelectedOption?.value || selectedPack) : undefined,
      price: finalPrice,
      quantity: hasPackOption ? 1 : quantity,
      image: product.images?.[0] || "",
      productType: product.productType,
      productId: product.id,
    });
  };

  return (
    <div data-source="partial" data-source-note="Title, price and stock are the product's. Sizes, colours and packs are not supported by the platform." data-section="product-info" className="flex flex-col gap-6 w-full">
      <div>
        {product.productType && (
          <span className="font-sans text-[11px] uppercase tracking-[0.2em] font-semibold text-[var(--featured-card-muted)] block mb-2">
            {product.productType}
          </span>
        )}
        <h1 className="font-heading text-[26px] sm:text-[34px] md:text-[40px] uppercase tracking-[0.05em] text-[var(--featured-text)] leading-tight">
          {product.title}
        </h1>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--separator-border)] pb-5">
        <span className="font-sans text-[22px] sm:text-[26px] font-bold text-[var(--featured-text)]">
          Rs. {displayPrice}
        </span>
        {hasDiscount && (
          <span className="font-sans text-[14px] sm:text-[16px] text-[var(--form-disabled-text)] line-through">
            Rs. {displayCompareAtPrice}
          </span>
        )}
        {hasDiscount && (
          <span className="rounded bg-[var(--discount-badge-bg)] px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.05em] text-[var(--discount-badge-text)]">
            SAVE {discountPercent}%
          </span>
        )}
        <span className="text-[11px] uppercase tracking-[0.1em] px-2.5 py-1 rounded font-semibold bg-[var(--status-positive-bg)] text-[var(--status-positive-text)]">
          {hasPackOption ? `In Stock (${selectedPack})` : "In Stock"}
        </span>
      </div>

      {hasPackOption && (
        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-medium uppercase tracking-[0.1em] text-[var(--featured-text)]">
            Select {packOptionName} Option:
          </div>
          <div className="grid grid-cols-2 gap-3">
            {packValues.map((pack) => (
              <button
                key={pack}
                type="button"
                onClick={() => setSelectedPack(pack)}
                className={`h-[44px] px-4 font-sans text-[12px] uppercase tracking-[0.05em] rounded border transition-all ${
                  selectedPack === pack
                    ? "bg-[var(--featured-text)] text-[var(--text-inverse)] border-[var(--featured-text)] font-bold shadow-sm"
                    : "bg-transparent text-[var(--featured-text)] border-[var(--separator-border)]"
                }`}
              >
                {pack}
              </button>
            ))}
          </div>
        </div>
      )}

      {sizeOptions.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-medium uppercase tracking-[0.1em] text-[var(--featured-text)]">
            Size: <strong className="font-semibold">{selectedSize}</strong>
          </div>
          <div className="flex flex-wrap gap-2">
            {sizeOptions.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => setSelectedSize(size)}
                className={`min-w-[44px] h-[40px] px-3 font-sans text-[12px] uppercase tracking-[0.05em] rounded border transition-all ${
                  selectedSize === size
                    ? "bg-[var(--featured-text)] text-[var(--text-inverse)] border-[var(--featured-text)] font-semibold"
                    : "bg-transparent text-[var(--featured-text)] border-[var(--separator-border)]"
                }`}
              >
                {size}
              </button>
            ))}
          </div>
        </div>
      )}

      {colorOptions.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-medium uppercase tracking-[0.1em] text-[var(--featured-text)]">
            Color Option: <strong className="font-semibold">{selectedColor}</strong>
          </div>
          <div className="flex flex-wrap gap-2">
            {colorOptions.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setSelectedColor(color)}
                className={`px-4 h-[40px] font-sans text-[12px] uppercase tracking-[0.05em] rounded border transition-all ${
                  selectedColor === color
                    ? "bg-[var(--featured-text)] text-[var(--text-inverse)] border-[var(--featured-text)] font-semibold"
                    : "bg-transparent text-[var(--featured-text)] border-[var(--separator-border)]"
                }`}
              >
                {color}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5 pt-2">
        <label className="text-[11px] uppercase tracking-[0.08em] font-medium text-[var(--featured-card-muted)]">
          Special Color Preferences (Optional):
        </label>
        <input
          type="text"
          value={customColorNote}
          onChange={(e) => setCustomColorNote(e.target.value)}
          placeholder="e.g. Prefer 2 Black + 1 Pink if available"
          className="w-full h-[42px] px-3 font-sans text-[12px] rounded border border-[var(--separator-border)] bg-transparent text-[var(--featured-text)] focus:border-[var(--featured-text)] focus:outline-none transition-all"
        />
      </div>

      {!hasPackOption && (
        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-medium uppercase tracking-[0.1em] text-[var(--featured-text)]">
            Quantity:
          </div>
          <div className="flex items-center border border-[var(--separator-border)] rounded w-fit">
            <button
              type="button"
              onClick={decrementQuantity}
              disabled={quantity <= 1}
              aria-label="Decrease quantity"
              className="w-[44px] h-[44px] flex items-center justify-center text-[var(--featured-text)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--featured-bg-secondary)] transition-colors"
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="w-[48px] text-center font-sans text-[14px] font-bold text-[var(--featured-text)]">
              {quantity}
            </span>
            <button
              type="button"
              onClick={incrementQuantity}
              disabled={quantity >= MAX_QUANTITY}
              aria-label="Increase quantity"
              className="w-[44px] h-[44px] flex items-center justify-center text-[var(--featured-text)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--featured-bg-secondary)] transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="pt-2">
        <button
          type="button"
          onClick={handleAddToCart}
          disabled={matchedVariant?.availableForSale === false}
          className="w-full h-[54px] bg-[var(--featured-text)] text-[var(--text-inverse)] font-sans text-[13px] uppercase tracking-[0.15em] font-bold rounded hover:opacity-95 active:scale-[0.99] transition-all disabled:opacity-50 cursor-pointer"
        >
          {matchedVariant?.availableForSale === false
            ? "Out of Stock"
            : hasPackOption
            ? `Add ${selectedPack} to Cart`
            : `Add ${quantity > 1 ? `${quantity} ` : ""}to Cart`}
        </button>
      </div>
    </div>
  );
}