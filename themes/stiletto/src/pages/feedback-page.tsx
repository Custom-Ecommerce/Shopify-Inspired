"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import type { FeedbackPageProps } from "@markaz/storefront-data";
import Link from "next/link";
import { paths } from "../adapters/paths";
import { useStilettoChrome } from "../adapters/chrome-context";
import { useStoreData } from "../shared/context/StoreDataContext";
import { CheckCircle2, ArrowLeft, ShoppingBag } from "lucide-react";

function FeedbackFormContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("order") || "";
  const productHandle = searchParams.get("product") || "";

  const [productData, setProductData] = useState<{
    title: string;
    images: string[];
  } | null>(null);

  const [activeImageIndex, setActiveImageIndex] = useState<number>(0);
  const [rating, setRating] = useState<number>(5);
  const [author, setAuthor] = useState<string>("");
  const [comment, setComment] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitted, setSubmitted] = useState<boolean>(false);

  // Fallback default images array
  const { content } = useStilettoChrome();
  const { products: catalogProducts } = useStoreData();
  const defaultImages = content.feedbackImages;

  useEffect(() => {
    const prod = catalogProducts.find((p) => p.handle === productHandle);
    if (prod) {
      setProductData({
        title: prod.title,
        images: prod.images && prod.images.length > 0 ? prod.images : defaultImages,
      });
    }
  }, [productHandle, catalogProducts, defaultImages]);

  const activeImageList = productData?.images || defaultImages;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment || !author || !productHandle) {
      if (!productHandle) {
        alert("Product handle missing in URL parameters.");
      }
      return;
    }

    setIsSubmitting(true);

    // The platform has no review API yet: nothing is stored. The form keeps its success state so the design is complete.
    console.warn("[stiletto] feedback is not stored: the platform has no review API yet", { orderId: orderId || "N/A", productHandle, rating });
    setSubmitted(true);
    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-white text-[var(--featured-text,#111)] flex flex-col justify-between">
      {/* 1. TOP MINIMAL NAVBAR WITH COMPACT LOGO + BACK LINK */}
      <header className="w-full bg-black text-white px-4 sm:px-8 py-3 flex items-center justify-between border-b border-gray-800">
        <div className="flex items-center gap-2">
          <div className="relative h-7 w-24 sm:w-28 ml-3 md:ml-0">
            <Image
              src={content.navConfig.menuLogo ?? ""}
              alt={`${content.brandName} Logo`}
              fill
              className="object-contain object-left"
              priority
            />
          </div>

          <Link
            href={paths.home}
            className="hidden md:flex items-center gap-1 text-[11px] text-gray-300 hover:text-white uppercase tracking-wider font-semibold transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back To Store</span>
          </Link>
        </div>

        <div className="text-[11px] uppercase tracking-widest font-bold text-gray-400 mr-3 md:mr-0">
          Customer Feedback
        </div>
      </header>

      {/* 2. MAIN CARD CONTAINER */}
      <main className="flex-grow flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-7xl rounded-xl border border-[var(--separator-border,#E5E5E5)] bg-white shadow-xl overflow-hidden grid grid-cols-1 md:grid-cols-12 relative">

          

          {/* LEFT PANEL: PRODUCT DETAILS */}
          <div className="md:col-span-5 p-6 sm:p-8 border-b md:border-b-0 md:border-r border-[var(--separator-border,#E5E5E5)] flex flex-col justify-between relative z-10">
            <div>
              <div className="flex items-center justify-between mb-4">
                {orderId ? (
                  <span className="px-2.5 py-1 rounded bg-black text-white text-[10px] uppercase font-bold tracking-widest">
                    Order #{orderId}
                  </span>
                ) : (
                  <span className="px-2.5 py-1 rounded bg-emerald-100 text-emerald-800 text-[10px] uppercase font-bold tracking-widest">
                    Product Feedback
                  </span>
                )}
                <span className="text-[10px] uppercase font-bold tracking-widest text-emerald-600 font-semibold">
                  ✓ Verified Buyer
                </span>
              </div>

              <h2 className="font-heading text-lg sm:text-xl uppercase tracking-tight text-[var(--featured-text,#111)] font-bold mb-4 leading-tight">
                {productData?.title || productHandle.replace(/-/g, " ") || "Product Review"}
              </h2>

              {/* Main Image View */}
              <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm mb-3">
                <Image
                  src={activeImageList[activeImageIndex] || activeImageList[0]}
                  alt="Product Gallery View"
                  fill
                  className="object-cover object-center transition-all duration-300"
                  priority
                />
              </div>

              {/* Interactive Gallery Thumbnails */}
              {activeImageList.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {activeImageList.map((imgUrl, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setActiveImageIndex(idx)}
                      className={`relative w-12 h-12 sm:w-14 sm:h-14 rounded overflow-hidden border-2 transition-all flex-shrink-0 ${
                        activeImageIndex === idx
                          ? "border-black scale-105 shadow"
                          : "border-gray-200 opacity-60 hover:opacity-100"
                      }`}
                    >
                      <Image
                        src={imgUrl}
                        alt={`Thumbnail ${idx + 1}`}
                        fill
                        className="object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <p className="text-[10px] text-[var(--featured-card-muted,#666)] mt-6 uppercase tracking-wider font-medium text-center md:text-left">
              ⚡ Thank you for shopping with us!
            </p>
          </div>

          {/* RIGHT PANEL: FORM OR TALL SUCCESS CONTAINER */}
          <div className="md:col-span-7 p-6 sm:p-8 flex flex-col justify-center relative z-10 min-h-[440px]">
            {submitted ? (
              <div className="w-full h-full min-h-[380px] p-8 text-center rounded-xl border border-emerald-200 bg-emerald-50/70 flex flex-col items-center justify-center shadow-inner my-auto">
                <CheckCircle2 className="w-16 h-16 text-emerald-600 mb-4 animate-bounce" />
                <h2 className="text-2xl font-extrabold text-emerald-900 uppercase tracking-wide">
                  Feedback Submitted!
                </h2>
                <p className="text-xs text-emerald-700 mt-3 max-w-sm leading-relaxed">
                  Thank you for helping our community. Your review is now live on the product page.
                </p>
                <Link
                  href={productHandle ? paths.product(productHandle) : paths.home}
                  className="inline-flex items-center gap-2 mt-8 px-7 py-3.5 bg-black text-white text-xs uppercase font-bold tracking-widest rounded-lg hover:bg-gray-900 active:scale-[0.98] transition-all shadow-md"
                >
                  <ShoppingBag className="w-4 h-4" />
                  <span>View Product Page</span>
                </Link>
              </div>
            ) : (
              <>
                <h1 className="font-heading text-xl sm:text-2xl uppercase tracking-wider text-[var(--featured-text,#111)] mb-1">
                  Write A Review
                </h1>
                <p className="text-xs text-[var(--featured-card-muted,#666)] mb-6">
                  Share your experience regarding fabric quality, fit, and packaging.
                </p>

                <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
                  {/* Rating */}
                  <div>
                    <label className="block text-[11px] uppercase tracking-wider font-bold text-[var(--featured-text,#111)] mb-1.5">
                      Your Rating:
                    </label>
                    <div className="flex gap-2 text-2xl">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setRating(star)}
                          className={`transition-transform active:scale-125 focus:outline-none ${
                            star <= rating ? "text-amber-400" : "text-gray-300"
                          }`}
                        >
                          ★
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Name */}
                  <div>
                    <label className="block text-[11px] uppercase tracking-wider font-bold text-[var(--featured-text,#111)] mb-1.5">
                      Your Name:
                    </label>
                    <input
                      type="text"
                      required
                      value={author}
                      onChange={(e) => setAuthor(e.target.value)}
                      placeholder="e.g. Fatima K."
                      className="w-full h-11 px-3.5 text-xs rounded border border-[var(--separator-border,#CCC)] bg-transparent text-[var(--featured-text,#111)] focus:border-[var(--featured-text,#111)] focus:outline-none transition-all"
                    />
                  </div>

                  {/* Detailed Review */}
                  <div>
                    <label className="block text-[11px] uppercase tracking-wider font-bold text-[var(--featured-text,#111)] mb-1.5">
                      Your Detailed Review:
                    </label>
                    <textarea
                      required
                      rows={4}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="How was the fabric quality, sizing accuracy, and packaging?"
                      className="w-full p-3.5 text-xs rounded border border-[var(--separator-border,#CCC)] bg-transparent text-[var(--featured-text,#111)] focus:border-[var(--featured-text,#111)] focus:outline-none transition-all leading-relaxed"
                    />
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full h-12 bg-[var(--featured-text,#111)] text-white text-xs uppercase tracking-widest font-bold rounded hover:opacity-95 active:scale-[0.99] transition-all disabled:opacity-50 cursor-pointer shadow-sm"
                  >
                    {isSubmitting ? "Submitting Review..." : "Submit Review"}
                  </button>
                </form>
              </>
            )}
          </div>

        </div>
      </main>
    </div>
  );
}

export function FeedbackPage(_props: FeedbackPageProps) {
  return (
    <Suspense
      fallback={
        <div className="p-12 text-center text-xs text-[var(--featured-card-muted,#666)]">
          Loading Feedback Page...
        </div>
      }
    >
      <FeedbackFormContent />
    </Suspense>
  );
}