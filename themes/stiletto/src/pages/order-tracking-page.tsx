"use client";

import React, { Suspense, useEffect, useRef } from "react";
import type { OrderTrackingPageProps } from "@markaz/storefront-data";
import { useOrderTracking } from "@markaz/storefront-data/client";
import { paths } from "../adapters/paths";
import { toTrackingSteps, trackingPlacedOn } from "../adapters/order";
import { useStilettoChrome } from "../adapters/chrome-context";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Package, Search, Truck, ExternalLink, AlertCircle, Loader2, PackageSearch, XCircle } from "lucide-react";

/*
 * Customer tracking (EP-02 OB-4, D-069). The shopper enters the order reference and the phone the order was placed with;
 * the answer is only the parcel's journey: a step line with dates, the courier and a tracking link. No name, address, items
 * or totals are fetched, and nothing typed here is stored in the browser.
 */
function TrackOrderContent({ initialOrderId }: { initialOrderId: string }) {
  const { content } = useStilettoChrome();
  const lookup = useOrderTracking(initialOrderId);
  const autoRan = useRef(false);

  const loading = lookup.status === "searching";
  const fieldError = lookup.errors.orderId ?? lookup.errors.phone ?? null;
  const hasSearched = lookup.status !== "editing" || fieldError !== null;
  const tracking = lookup.status === "found" ? lookup.tracking : null;
  const steps = tracking ? toTrackingSteps(tracking) : [];
  const error =
    fieldError ??
    (lookup.status === "not_found"
      ? "No order matches this reference and phone number. Please check both and try again."
      : lookup.status === "error"
        ? lookup.failure?.kind === "rate_limited"
          ? "Too many attempts. Please wait a minute and try again."
          : "We could not check your order right now. Please try again."
        : null);

  // A link that carries both the order reference and the phone (the confirmation page's) looks the order up straight away.
  const linkedPhone = useSearchParams().get("phone") ?? "";
  useEffect(() => {
    if (autoRan.current || !initialOrderId || !linkedPhone) return;
    if (lookup.values.phone !== linkedPhone) {
      lookup.setField("phone", linkedPhone);
      return;
    }
    autoRan.current = true;
    void lookup.submit();
  }, [initialOrderId, linkedPhone, lookup]);

  const handleTrackSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void lookup.submit();
  };

  return (
    <div className="min-h-screen bg-white text-black font-sans flex flex-col justify-between relative overflow-hidden">
      {/* 1. TOP NAVBAR WITH BRANDING LOGO */}
      <header className="w-full bg-black text-white px-4 sm:px-8 py-3 flex items-center justify-between border-b border-gray-800 z-10 relative">
        <div className="flex items-center gap-3">
          <div className="relative h-7 w-24 sm:w-28">
            <Image src={content.navConfig.menuLogo ?? ""} alt={`${content.brandName} Logo`} fill className="object-contain object-left" priority />
          </div>

          <Link
            href={paths.home}
            className="hidden sm:flex items-center gap-1.5 text-[11px] text-gray-300 hover:text-white uppercase tracking-wider font-semibold transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back To Store</span>
          </Link>
        </div>

        <div className="text-[11px] uppercase tracking-widest font-bold text-gray-400">Track Your Order</div>
      </header>

      {/* 2. MAIN CONTAINER */}
      <main className="flex-grow flex items-center justify-center p-4 sm:p-6 md:p-8 z-10 relative">
        <div className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* LEFT COLUMN: LOOKUP FORM */}
          <div className="lg:col-span-5 rounded-2xl border border-[var(--separator-border,#E5E5E5)] bg-white/95 backdrop-blur-sm shadow-lg p-6 min-h-[360px] lg:min-h-[420px] flex flex-col justify-between">
            <div className="flex flex-col h-full justify-between space-y-4">
              <div className="text-left space-y-1">
                <h1 className="font-heading text-xl sm:text-2xl uppercase tracking-wider text-[var(--featured-text,#111)] font-bold">
                  Track Your Order
                </h1>
                <p className="text-xs text-[var(--featured-card-muted,#666)] leading-relaxed">
                  Enter your order reference (for example ORD-7KQ4M2XA) and the phone number you ordered with.
                </p>
              </div>

              <form onSubmit={handleTrackSubmit} className="flex-1 flex flex-col justify-between space-y-5 pt-2" noValidate>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label htmlFor="track-order-id" className="block text-[11px] uppercase tracking-wider font-bold text-[var(--featured-text,#111)]">
                      Order Reference
                    </label>
                    <input
                      id="track-order-id"
                      type="text"
                      required
                      autoComplete="off"
                      placeholder="ORD-7KQ4M2XA"
                      value={lookup.values.orderId}
                      onChange={(e) => lookup.setField("orderId", e.target.value)}
                      aria-invalid={lookup.errors.orderId ? true : undefined}
                      className="w-full h-11 bg-white/80 border border-[var(--separator-border,#CCC)] rounded-lg px-3.5 text-sm text-[var(--featured-text,#111)] focus:border-black focus:outline-none transition-all"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="track-phone" className="block text-[11px] uppercase tracking-wider font-bold text-[var(--featured-text,#111)]">
                      Phone Number Used For The Order
                    </label>
                    <input
                      id="track-phone"
                      type="tel"
                      required
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="0300 1234567"
                      value={lookup.values.phone}
                      onChange={(e) => lookup.setField("phone", e.target.value)}
                      aria-invalid={lookup.errors.phone ? true : undefined}
                      className="w-full h-11 bg-white/80 border border-[var(--separator-border,#CCC)] rounded-lg px-3.5 text-sm text-[var(--featured-text,#111)] focus:border-black focus:outline-none transition-all"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11 bg-black text-white text-xs uppercase tracking-widest font-bold rounded-lg hover:bg-gray-900 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm disabled:opacity-50 mt-auto"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Searching...</span>
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4" />
                      <span>Check Status</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>

          {/* RIGHT COLUMN: STATUS PANEL */}
          <div
            className="lg:col-span-7 rounded-2xl border border-[var(--separator-border,#E5E5E5)] bg-white/95 backdrop-blur-sm shadow-lg p-6 min-h-[320px] lg:min-h-[420px] flex flex-col justify-center"
            aria-live="polite"
          >
            {/* IDLE */}
            {!hasSearched && !loading && (
              <div className="text-center py-8 space-y-3">
                <div className="w-14 h-14 rounded-full bg-gray-100/80 flex items-center justify-center mx-auto text-gray-400">
                  <PackageSearch className="w-7 h-7" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-gray-800">No Order Selected</h3>
                  <p className="text-xs text-gray-500 max-w-sm mx-auto leading-relaxed">
                    Enter your order reference and phone number to see where your parcel is.
                  </p>
                </div>
              </div>
            )}

            {/* LOADING */}
            {loading && (
              <div className="text-center py-8 space-y-3">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-800" />
                <p className="text-xs uppercase tracking-wider font-bold text-gray-600">Checking Your Order...</p>
              </div>
            )}

            {/* ERROR / NOT FOUND */}
            {error && !loading && (
              <div role="alert" className="p-5 rounded-xl bg-rose-50/90 border border-rose-200 text-rose-900 space-y-2.5 my-auto">
                <div className="flex items-center gap-2 font-bold text-xs uppercase tracking-wider text-rose-700">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>Order Not Found</span>
                </div>
                <p className="text-xs text-rose-800 leading-relaxed">{error}</p>
              </div>
            )}

            {/* CANCELLED: the status only */}
            {tracking && !loading && tracking.status === "cancelled" && (
              <div className="space-y-3 my-auto text-center py-6">
                <XCircle className="w-10 h-10 mx-auto text-rose-600" />
                <p className="text-[10px] text-gray-500 font-mono uppercase tracking-wider break-all">Order {tracking.orderId}</p>
                <p className="text-base font-bold uppercase tracking-widest text-rose-700">Cancelled</p>
              </div>
            )}

            {/* RETURNED: the status only (returns are handled outside this flow) */}
            {tracking && !loading && tracking.status === "returned" && (
              <div className="space-y-3 my-auto text-center py-6">
                <Package className="w-10 h-10 mx-auto text-gray-500" />
                <p className="text-[10px] text-gray-500 font-mono uppercase tracking-wider break-all">Order {tracking.orderId}</p>
                <p className="text-base font-bold uppercase tracking-widest text-gray-700">Returned</p>
              </div>
            )}

            {/* ON ITS WAY: the step line */}
            {tracking && !loading && steps.length > 0 && (
              <div className="space-y-5 my-auto">
                <div className="bg-black text-white p-3.5 rounded-xl flex items-center justify-between gap-3 shadow-sm">
                  <div className="min-w-0">
                    <p className="text-[10px] text-gray-400 font-mono uppercase tracking-wider break-all">
                      Order {tracking.orderId}
                      {trackingPlacedOn(tracking) ? ` • ${trackingPlacedOn(tracking)}` : ""}
                    </p>
                    <p className="text-xs sm:text-sm font-bold text-emerald-400 uppercase mt-0.5 tracking-wide">
                      {steps.find((step) => step.current)?.label ?? ""}
                    </p>
                  </div>
                  {tracking.status === "dispatched" || tracking.status === "delivered" ? (
                    <Truck className="w-5 h-5 text-emerald-400 shrink-0" />
                  ) : (
                    <Package className="w-5 h-5 text-emerald-400 shrink-0" />
                  )}
                </div>

                {/* Courier and tracking (only while dispatched or delivered; the server sends nothing otherwise) */}
                {(tracking.courier || tracking.trackingNumber) && (
                  <div className="p-3 bg-emerald-50/90 border border-emerald-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-emerald-900">
                    <div className="min-w-0">
                      {tracking.courier && (
                        <span className="font-bold block uppercase text-[10px] text-emerald-700">Courier: {tracking.courier}</span>
                      )}
                      {tracking.trackingNumber && (
                        <span className="font-mono text-[11px] break-all">Tracking number: {tracking.trackingNumber}</span>
                      )}
                    </div>
                    {tracking.trackingUrl && (
                      <a
                        href={tracking.trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-1 h-11 sm:h-auto px-3 sm:py-1 bg-emerald-700 text-white font-bold text-[10px] uppercase tracking-wider rounded hover:bg-emerald-800 transition-colors shrink-0"
                      >
                        <span>Track Package</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                )}

                {/* Step line */}
                <ol className="space-y-3.5 px-1">
                  {steps.map((step) => (
                    <li key={step.key} className={`flex items-start gap-3 ${step.done ? "opacity-100" : "opacity-50"}`}>
                      <span
                        aria-hidden="true"
                        className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] shrink-0 mt-0.5 font-bold ${
                          step.done ? "bg-emerald-500 text-white" : "bg-gray-200 text-gray-600"
                        }`}
                      >
                        {step.done ? "✓" : ""}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-black uppercase tracking-wider">
                          {step.label}
                          {step.current ? <span className="sr-only"> (current step)</span> : null}
                        </p>
                        <p className="text-[11px] text-gray-500">{step.date ?? (step.done ? "Done" : "Not yet")}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export function OrderTrackingPage({ orderId }: OrderTrackingPageProps) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white flex items-center justify-center text-xs text-gray-500">Loading order tracking...</div>}>
      <TrackOrderContent initialOrderId={orderId ?? ""} />
    </Suspense>
  );
}
