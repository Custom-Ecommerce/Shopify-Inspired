"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { initialSelection, toVariantSelectionVM, toggleOption } from "@markaz/storefront-data";
import type { ProductDetailVM, SelectableValue, VariantBlock } from "@markaz/storefront-data";
import { useCartContext } from "../../shared/context/CartContext";
import { FavouriteButton } from "../../shared/components/product/FavouriteButton";
import { PreviewLabel } from "../../shared/components/product/PreviewLabel";
import type { NormalizedProduct } from "../../types";

interface ProductInfoProps {
  product: NormalizedProduct;
  detail: ProductDetailVM;
  /** Tells the gallery which image the chosen variant shows. */
  onVariantImage: (imageId: string | null) => void;
}

const MAX_QUANTITY = 10;

const BLOCK_LABELS: Record<VariantBlock, string> = {
  choose_options: "Choose your options",
  out_of_stock: "Out of Stock",
  preview_only: "Not for sale yet",
};

/** The words beside a value that cannot be chosen. */
function valueNote(value: SelectableValue): string | null {
  if (value.state === "out_of_stock") return "Out of stock";
  if (value.state === "missing") return "Not available";
  return null;
}

export function ProductInfo({ product, detail, onVariantImage }: ProductInfoProps) {
  const { addToCart } = useCartContext();

  const [selected, setSelected] = useState(() => initialSelection(detail));
  const [customColorNote, setCustomColorNote] = useState<string>("");
  const [quantity, setQuantity] = useState<number>(1);

  const selection = useMemo(() => toVariantSelectionVM(detail, selected), [detail, selected]);
  const { variant, block } = selection;

  useEffect(() => {
    onVariantImage(selection.imageId);
  }, [onVariantImage, selection.imageId]);

  const incrementQuantity = () => setQuantity((q) => Math.min(MAX_QUANTITY, q + 1));
  const decrementQuantity = () => setQuantity((q) => Math.max(1, q - 1));

  const handleAddToCart = () => {
    if (!variant || block !== null) return;
    const image = detail.gallery.find((entry) => entry.id !== null && entry.id === variant.imageId)?.url ?? product.images?.[0] ?? "";

    addToCart({
      lineId: variant.id,
      handle: product.handle,
      title: product.title,
      variantTitle: detail.options.length > 0 ? variant.title : undefined,
      color: customColorNote || undefined,
      price: String(variant.price.amount),
      quantity,
      image,
      productType: product.productType,
      productId: product.id,
    });
  };

  return (
    <div data-source="dynamic" data-source-note="Title, price, stock, options and variants are the product's." data-section="product-info" className="flex flex-col gap-6 w-full">
      <div>
        {product.productType && (
          <span className="font-sans text-[11px] uppercase tracking-[0.2em] font-semibold text-[var(--featured-card-muted)] block mb-2">
            {product.productType}
          </span>
        )}
        <PreviewLabel label={product.previewLabel} className="mb-2" />
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-heading text-[26px] sm:text-[34px] md:text-[40px] uppercase tracking-[0.05em] text-[var(--featured-text)] leading-tight">
            {product.title}
          </h1>
          <FavouriteButton productId={product.id} title={product.title} previewLabel={product.previewLabel} className="shrink-0" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--separator-border)] pb-5">
        <span className="font-sans text-[22px] sm:text-[26px] font-bold text-[var(--featured-text)]">
          {selection.priceFrom ? "From " : ""}Rs. {selection.price.amount.toLocaleString("en-PK")}
        </span>
        {selection.compareAt && selection.discountPercent > 0 && (
          <>
            <span className="font-sans text-[14px] sm:text-[16px] text-[var(--form-disabled-text)] line-through">
              Rs. {selection.compareAt.amount.toLocaleString("en-PK")}
            </span>
            <span className="rounded bg-[var(--discount-badge-bg)] px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.05em] text-[var(--discount-badge-text)]">
              SAVE {selection.discountPercent}%
            </span>
          </>
        )}
        {selection.stock.status === "out_of_stock" ? (
          <span className="text-[11px] uppercase tracking-[0.1em] px-2.5 py-1 rounded font-semibold bg-[var(--featured-bg-secondary)] text-[var(--featured-card-muted)]">
            {selection.stock.label}
          </span>
        ) : (
          <span className="text-[11px] uppercase tracking-[0.1em] px-2.5 py-1 rounded font-semibold bg-[var(--status-positive-bg)] text-[var(--status-positive-text)]">
            {selection.stock.label}
          </span>
        )}
      </div>

      {selection.options.map((option, optionIndex) => (
        <div key={option.name} className="flex flex-col gap-2">
          <div className="text-[12px] font-medium uppercase tracking-[0.1em] text-[var(--featured-text)]">
            {option.name}: <strong className="font-semibold">{selected[optionIndex] ?? "Choose"}</strong>
          </div>
          <div className="flex flex-wrap gap-2">
            {option.values.map((value) => {
              const note = valueNote(value);
              return (
                <button
                  key={value.value}
                  type="button"
                  // A chosen value stays clickable even when sold out: choosing it again clears it.
                  disabled={note !== null && !value.selected}
                  aria-pressed={value.selected}
                  title={note ?? undefined}
                  onClick={() => setSelected((current) => toggleOption(current, optionIndex, value.value))}
                  className={`min-w-[44px] min-h-[40px] px-3 py-1 font-sans text-[12px] uppercase tracking-[0.05em] rounded border transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                    value.selected
                      ? "bg-[var(--featured-text)] text-[var(--text-inverse)] border-[var(--featured-text)] font-semibold"
                      : "bg-transparent text-[var(--featured-text)] border-[var(--separator-border)]"
                  }`}
                >
                  <span className={note ? "line-through" : undefined}>{value.value}</span>
                  {note && <span className="block text-[9px] normal-case tracking-normal">{note}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}

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

      <div className="pt-2">
        <button
          type="button"
          onClick={handleAddToCart}
          disabled={block !== null}
          className="w-full h-[54px] bg-[var(--featured-text)] text-[var(--text-inverse)] font-sans text-[13px] uppercase tracking-[0.15em] font-bold rounded hover:opacity-95 active:scale-[0.99] transition-all disabled:opacity-50 cursor-pointer"
        >
          {block !== null ? BLOCK_LABELS[block] : `Add ${quantity > 1 ? `${quantity} ` : ""}to Cart`}
        </button>
      </div>
    </div>
  );
}
