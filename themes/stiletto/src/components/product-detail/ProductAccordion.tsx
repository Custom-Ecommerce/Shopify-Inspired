"use client";

import type { NormalizedProductSpec } from "../../types";
import { useState } from "react";

interface ProductAccordionProps {
  descriptionHtml?: string;
  plainTextDescription?: string;
  specs?: NormalizedProductSpec[];
  shippingDetails?: string[];
}

export function ProductAccordion({
  descriptionHtml,
  plainTextDescription,
  specs = [],
  shippingDetails = [],
}: ProductAccordionProps) {
  const [openSection, setOpenSection] = useState<string | null>("description");

  const toggleSection = (id: string) => {
    setOpenSection((prev) => (prev === id ? null : id));
  };

  return (
    <div data-source="partial" data-source-note="Description is the product's; shipping and care text is theme content." data-section="product-accordion" className="w-full border-t border-[var(--separator-border)] mt-8">
      {/* 1. Description & Metafield Specs Tab */}
      <div className="border-b border-[var(--separator-border)]">
        <button
          type="button"
          onClick={() => toggleSection("description")}
          className="w-full py-4 flex justify-between items-center text-left font-heading text-[16px] uppercase tracking-[0.1em] text-[var(--featured-text)] font-semibold"
        >
          <span>Product Description</span>
          <span className="text-[18px]">{openSection === "description" ? "−" : "+"}</span>
        </button>

        {openSection === "description" && (
          <div className="pb-6 font-sans text-[13px] leading-relaxed text-[var(--featured-card-muted)] space-y-3">
            {descriptionHtml ? (
              <div
                className="prose prose-sm max-w-none text-[var(--featured-card-muted)]"
                dangerouslySetInnerHTML={{ __html: descriptionHtml }}
              />
            ) : (
              <p>{plainTextDescription || "No additional description available."}</p>
            )}

            {/* Category Spec Metafields (Fabric, Age Group, Target Gender) */}
            {specs.length > 0 && (
              <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 border-t border-[var(--separator-border)] pt-4">
                {specs.map((spec) => (
                  <div
                    key={spec.key}
                    className="flex items-baseline justify-between gap-3 border-b border-[var(--separator-border)]/60 py-1.5"
                  >
                    <dt className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[var(--featured-text)] shrink-0">
                      {spec.label}
                    </dt>
                    <dd className="text-[12px] text-[var(--featured-card-muted)] text-right">
                      {spec.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}
      </div>

      {/* 2. Central Shipping & Returns Tab */}
      <div>
        <button
          type="button"
          onClick={() => toggleSection("shipping")}
          className="w-full py-4 flex justify-between items-center text-left font-heading text-[16px] uppercase tracking-[0.1em] text-[var(--featured-text)] font-semibold"
        >
          <span>Shipping & Returns</span>
          <span className="text-[18px]">{openSection === "shipping" ? "−" : "+"}</span>
        </button>

        {openSection === "shipping" && (
          <div className="pb-6 font-sans text-[13px] leading-relaxed text-[var(--featured-card-muted)] space-y-2">
            {shippingDetails.length > 0 ? (
              shippingDetails.map((line, i) => <p key={i}>• {line}</p>)
            ) : (
              <p>Standard shipping details are not configured for this store yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}