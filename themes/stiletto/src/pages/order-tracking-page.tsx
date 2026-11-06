"use client";

import React, { Suspense, useEffect, useRef } from "react";
import type { OrderTrackingPageProps } from "@markaz/storefront-data";
import { useOrderLookup } from "@markaz/storefront-data/client";
import { paths } from "../adapters/paths";
import { toTrackedOrder } from "../adapters/order";
import { useStilettoChrome } from "../adapters/chrome-context";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  Package,
  Search,
  Truck,
  ExternalLink,
  AlertCircle,
  Loader2,
  PackageSearch,
} from "lucide-react";

function TrackOrderContent({ initialOrderId }: { initialOrderId: string }) {
  const { content } = useStilettoChrome();
  const lookup = useOrderLookup(initialOrderId);
  const autoRan = useRef(false);

  const orderQuery = lookup.values.orderId;
  const setOrderQuery = (value: string) => lookup.setField("orderId", value);
  const phoneQuery = lookup.values.phone;
  const setPhoneQuery = (value: string) => lookup.setField("phone", value);
  const loading = lookup.status === "searching";
  const fieldError = lookup.errors.orderId ?? lookup.errors.phone ?? null;
  const hasSearched = lookup.status !== "editing" || fieldError !== null;
  const orderData = lookup.order ? toTrackedOrder(lookup.order) : null;
  const error =
    fieldError ??
    (lookup.status === "not_found"
      ? "Order not found in store records. Please check the reference number and phone number."
      : lookup.status === "error"
        ? "Network error fetching order details. Please try again."
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
            className="hidden sm:flex items-center gap-1.5 text-[11px] text-gray-300 hover:text-white uppercase tracking-wider font-semibold transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back To Store</span>
          </Link>
        </div>

        <div className="text-[11px] uppercase tracking-widest font-bold text-gray-400">
          Track Your Order
        </div>
      </header>

      {/* 2. MAIN CONTAINER */}
      <main className="flex-grow flex items-center justify-center p-4 sm:p-6 md:p-8 z-10 relative">
        <div className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          
          {/* LEFT COLUMN: LOOKUP FORM */}
          <div className="lg:col-span-5 rounded-2xl border border-[var(--separator-border,#E5E5E5)] bg-white/95 backdrop-blur-sm shadow-lg p-6 min-h-[400px] lg:min-h-[420px] flex flex-col justify-between">
            <div className="flex flex-col h-full justify-between space-y-4">
              <div className="text-left space-y-1">
                <h1 className="font-heading text-xl sm:text-2xl uppercase tracking-wider text-[var(--featured-text,#111)] font-bold">
                  Order Status Lookup
                </h1>
                <p className="text-xs text-[var(--featured-card-muted,#666)] leading-relaxed">
                  Enter your Order Reference Number (e.g. #1001su) to check real-time progress.
                </p>
              </div>

              {/* Form */}
              <form onSubmit={handleTrackSubmit} className="flex-1 flex flex-col justify-between space-y-5 pt-2">
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-[11px] uppercase tracking-wider font-bold text-[var(--featured-text,#111)]">
                      Order Reference Number
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="#1001su"
                      value={orderQuery}
                      onChange={(e) => setOrderQuery(e.target.value)}
                      className="w-full h-11 bg-white/80 border border-[var(--separator-border,#CCC)] rounded-lg px-3.5 text-xs text-[var(--featured-text,#111)] focus:border-black focus:outline-none transition-all"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[11px] uppercase tracking-wider font-bold text-[var(--featured-text,#111)]">
                      Registered WhatsApp Number (Optional)
                    </label>
                    <input
                      type="tel"
                      placeholder="0300 1234567"
                      value={phoneQuery}
                      onChange={(e) => setPhoneQuery(e.target.value)}
                      className="w-full h-11 bg-white/80 border border-[var(--separator-border,#CCC)] rounded-lg px-3.5 text-xs text-[var(--featured-text,#111)] focus:border-black focus:outline-none transition-all"
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
          <div className="lg:col-span-7 rounded-2xl border border-[var(--separator-border,#E5E5E5)] bg-white/95 backdrop-blur-sm shadow-lg p-6 min-h-[400px] lg:min-h-[420px] flex flex-col justify-center">
            
            {/* STATE 1: IDLE / EMPTY STATE */}
            {!hasSearched && !loading && (
              <div className="text-center py-8 space-y-3">
                <div className="w-14 h-14 rounded-full bg-gray-100/80 flex items-center justify-center mx-auto text-gray-400">
                  <PackageSearch className="w-7 h-7" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-gray-800">
                    No Order Selected
                  </h3>
                  <p className="text-xs text-gray-500 max-w-sm mx-auto leading-relaxed">
                    Please enter your order reference number on the left panel to fetch live tracking and shipping updates.
                  </p>
                </div>
              </div>
            )}

            {/* LOADING OVERLAY */}
            {loading && (
              <div className="text-center py-8 space-y-3">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-800" />
                <p className="text-xs uppercase tracking-wider font-bold text-gray-600">
                  Fetching Order Records...
                </p>
              </div>
            )}

            {/* STATE 2: ERROR STATE */}
            {error && !loading && (
              <div className="p-5 rounded-xl bg-rose-50/90 border border-rose-200 text-rose-900 space-y-2.5 animate-fadeIn my-auto">
                <div className="flex items-center gap-2 font-bold text-xs uppercase tracking-wider text-rose-700">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>Order Lookup Failed</span>
                </div>
                <p className="text-xs text-rose-800 leading-relaxed font-mono">
                  {error}
                </p>
              </div>
            )}

            {/* STATE 3: SUCCESS STATE */}
            {orderData && !loading && (
              <div className="space-y-5 my-auto animate-fadeIn">
                
                {/* Top Banner Status */}
                <div className="bg-black text-white p-3.5 rounded-xl flex items-center justify-between shadow-sm">
                  <div>
                    <p className="text-[10px] text-gray-400 font-mono uppercase tracking-wider">
                      Order {orderData.name} • {orderData.createdAt}
                    </p>
                    <p className="text-xs sm:text-sm font-bold text-emerald-400 uppercase mt-0.5 tracking-wide">
                      {orderData.fulfillmentStatus === "FULFILLED"
                        ? "Dispatched & On The Way"
                        : "Order Confirmed (Processing)"}
                    </p>
                  </div>
                  <Package className="w-5 h-5 text-emerald-400 shrink-0" />
                </div>

                {/* Courier Tracking Link Banner */}
                {orderData.tracking?.url && (
                  <div className="p-3 bg-emerald-50/90 border border-emerald-200 rounded-xl flex items-center justify-between text-xs text-emerald-900">
                    <div>
                      <span className="font-bold block uppercase text-[10px] text-emerald-700">
                        Courier Partner: {orderData.tracking.company || "Express Delivery"}
                      </span>
                      <span className="font-mono text-[11px]">
                        Tracking ID: {orderData.tracking.number}
                      </span>
                    </div>
                    <a
                      href={orderData.tracking.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-700 text-white font-bold text-[10px] uppercase tracking-wider rounded hover:bg-emerald-800 transition-colors"
                    >
                      <span>Track Package</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}

                {/* Progress Timeline */}
                <div className="space-y-3.5 px-1">
                  <div className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-emerald-500 text-white font-bold flex items-center justify-center text-[11px] shrink-0 mt-0.5">
                      ✓
                    </div>
                    <div>
                      <p className="text-xs font-bold text-black uppercase tracking-wider">Order Placed</p>
                      <p className="text-[11px] text-gray-500">
                        Received on {orderData.createdAt} ({orderData.totalPrice})
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-emerald-500 text-white font-bold flex items-center justify-center text-[11px] shrink-0 mt-0.5">
                      ✓
                    </div>
                    <div>
                      <p className="text-xs font-bold text-black uppercase tracking-wider">
                        Address & Payment Verification
                      </p>
                      <p className="text-[11px] text-gray-500">
                        Payment Status: <strong className="uppercase">{orderData.financialStatus}</strong>
                      </p>
                    </div>
                  </div>

                  <div
                    className={`flex items-start gap-3 ${
                      orderData.fulfillmentStatus === "FULFILLED" ? "opacity-100" : "opacity-50"
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] shrink-0 mt-0.5 font-bold ${
                        orderData.fulfillmentStatus === "FULFILLED"
                          ? "bg-emerald-500 text-white"
                          : "bg-gray-200 text-gray-600"
                      }`}
                    >
                      {orderData.fulfillmentStatus === "FULFILLED" ? (
                        "✓"
                      ) : (
                        <Truck className="w-3 h-3" />
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-black uppercase tracking-wider">
                        Dispatched & Out for Delivery
                      </p>
                      <p className="text-[11px] text-gray-500">
                        {orderData.fulfillmentStatus === "FULFILLED"
                          ? "Package handed over to courier service"
                          : "Preparing item packaging in warehouse"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Items Summary */}
                {orderData.items && orderData.items.length > 0 && (
                  <div className="pt-3 border-t border-gray-100 space-y-2">
                    <span className="text-[10px] uppercase font-bold tracking-widest text-gray-500 block">
                      Items In Order ({orderData.items.length})
                    </span>
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {orderData.items.map((item, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2 rounded border border-gray-100 bg-gray-50/50 text-xs"
                        >
                          <div className="flex items-center gap-2">
                            {item.image ? (
                              <div className="relative w-7 h-7 rounded overflow-hidden shrink-0 border border-gray-200">
                                <Image
                                  src={item.image}
                                  alt={item.title}
                                  fill
                                  className="object-cover"
                                />
                              </div>
                            ) : (
                              <Package className="w-4 h-4 text-gray-400 shrink-0" />
                            )}
                            <span className="font-medium text-gray-900 line-clamp-1">
                              {item.title} × {item.quantity}
                            </span>
                          </div>
                          <span className="font-bold text-gray-700 shrink-0 ml-2">
                            {item.price}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

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
    <Suspense
      fallback={
        <div className="min-h-screen bg-white flex items-center justify-center text-xs text-gray-500">
          Loading order tracking...
        </div>
      }
    >
      <TrackOrderContent initialOrderId={orderId ?? ""} />
    </Suspense>
  );
}