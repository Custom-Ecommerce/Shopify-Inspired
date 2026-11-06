"use client";

import { CheckCircle2, PackageCheck, Search, ShoppingBag } from "lucide-react";
import Link from "next/link";
import React, { Suspense, useEffect, useState } from "react";
import type { OrderConfirmationPageProps } from "@markaz/storefront-data";
import { paths } from "../adapters/paths";
import { readLastOrder } from "../adapters/last-order";
import type { LastOrder } from "../adapters/last-order";

function SuccessContent({ orderId }: { orderId: string }) {
  const [summary, setSummary] = useState<LastOrder | null>(null);
  useEffect(() => {
    setSummary(readLastOrder(orderId));
  }, [orderId]);
  const orderName = orderId;
  const amount = summary ? String(summary.total) : "0";
  const whatsapp = summary ? summary.whatsapp : "N/A";

  const formattedAmount = `Rs. ${Math.round(Number(amount)).toLocaleString("en-PK")}`;

  return (
    <div className="min-h-screen bg-white text-black flex items-center justify-center p-4 font-sans">
      <div className="max-w-md w-full bg-black text-white rounded-2xl p-6 sm:p-8 text-center space-y-6 shadow-2xl border border-black">
        {/* Animated Check Icon */}
        <div className="w-16 h-16 bg-emerald-500/10 text-emerald-400 rounded-full flex items-center justify-center mx-auto border border-emerald-500/20">
          <CheckCircle2 className="w-10 h-10" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold uppercase tracking-wider">
            Order Confirmed!
          </h1>
          <p className="text-sm text-white/60">
            Thank you for your order. We will contact you on WhatsApp shortly.
          </p>
        </div>

        {/* Details Card */}
        <div className="bg-white/10 border border-white/10 rounded-xl p-4 text-left space-y-2.5 text-xs font-mono">
          <div className="flex justify-between text-white/70">
            <span>Order Reference:</span>
            <span className="font-bold text-white">{orderName}</span>
          </div>
          <div className="flex justify-between text-white/70">
            <span>Payment Method:</span>
            <span className="font-semibold text-white">Cash on Delivery (Pending)</span>
          </div>
          <div className="flex justify-between text-white/70">
            <span>WhatsApp:</span>
            <span className="font-semibold text-white">{whatsapp}</span>
          </div>
          <div className="flex justify-between text-white/70 pt-2 border-t border-white/10 text-sm font-bold text-white">
            <span>Total Payable:</span>
            <span>{formattedAmount}</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3 pt-2">
          <Link
            href={`${paths.track(orderName)}&phone=${encodeURIComponent(whatsapp)}`}
            className="w-full h-11 bg-emerald-500 hover:bg-emerald-600 text-black font-sans text-xs uppercase tracking-widest font-bold rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg"
          >
            <Search className="w-4 h-4" />
            Track Order
          </Link>

          <Link
            href={paths.home}
            className="w-full h-11 bg-white hover:bg-white/90 text-black font-sans text-xs uppercase tracking-widest font-bold rounded-xl flex items-center justify-center gap-2 transition-all block"
          >
            <ShoppingBag className="w-4 h-4" />
            Continue Shopping
          </Link>
        </div>
      </div>
    </div>
  );
}

export function OrderConfirmationPage({ orderId }: OrderConfirmationPageProps) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white flex items-center justify-center text-black">Loading order confirmation...</div>}>
      <SuccessContent orderId={orderId} />
    </Suspense>
  );
}