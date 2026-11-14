"use client";

import { CheckCircle2, Loader2, Search, ShoppingBag, XCircle } from "lucide-react";
import Link from "next/link";
import React, { Suspense } from "react";
import type { OrderConfirmationPageProps, StorefrontOrder } from "@markaz/storefront-data";
import { useOrderLookup } from "@markaz/storefront-data/client";
import { paths } from "../adapters/paths";
import { paymentSummary, whatHappensNext } from "../adapters/last-order";
import { useConfirmedOrder } from "../adapters/order-payment";

const money = (amount: number) => `Rs. ${Math.round(amount).toLocaleString("en-PK")}`;

const shell = "min-h-screen bg-white text-black flex items-center justify-center p-4 font-sans";
const card = "max-w-md w-full bg-black text-white rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl border border-black";

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "pt-2 border-t border-white/10 text-sm font-bold text-white" : "text-white/70"}`}>
      <span className="shrink-0">{label}</span>
      <span className={`text-right break-words min-w-0 ${strong ? "" : "font-semibold text-white"}`}>{value}</span>
    </div>
  );
}

function OrderDetails({ order }: { order: StorefrontOrder }) {
  const payment = paymentSummary(order);
  const cancelled = order.status === "cancelled";

  return (
    <div className={card}>
      <div className="text-center space-y-3">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto border ${cancelled ? "bg-rose-500/10 text-rose-400 border-rose-500/30" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"}`}>
          {cancelled ? <XCircle className="w-8 h-8" /> : <CheckCircle2 className="w-8 h-8" />}
        </div>
        <h1 className="text-2xl font-bold uppercase tracking-wider">{cancelled ? "Order Cancelled" : "Order Confirmed!"}</h1>
        <p className="text-sm text-white/60">{whatHappensNext(order)}</p>
      </div>

      <div className="bg-white/10 border border-white/10 rounded-xl p-4 space-y-2.5 text-xs">
        <Row label="Order number" value={order.orderId} />
        <Row label="Payment" value={payment.method} />
        <Row label="Status" value={payment.state} />
      </div>

      <div className="bg-white/10 border border-white/10 rounded-xl p-4 space-y-2.5 text-xs">
        <ul className="space-y-2">
          {order.items.map((item) => (
            <li key={item.variantId} className="flex justify-between gap-4 text-white/70">
              <span className="min-w-0 break-words">
                {item.title}
                {item.variantTitle && item.variantTitle !== "Default" ? ` (${item.variantTitle})` : ""} x {item.qty}
              </span>
              <span className="shrink-0 font-semibold text-white">{money(item.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <div className="space-y-2 pt-2 border-t border-white/10">
          <Row label="Subtotal" value={money(order.subtotal)} />
          {order.discount > 0 && <Row label="Discount" value={`-${money(order.discount)}`} />}
          <Row label="Delivery" value={order.deliveryCharges > 0 ? money(order.deliveryCharges) : "Free"} />
          <Row label="Total" value={money(order.total)} strong />
        </div>
      </div>

      <div className="bg-white/10 border border-white/10 rounded-xl p-4 text-xs space-y-1">
        <p className="text-white/70">Delivering to</p>
        <p className="font-semibold text-white break-words">
          {order.address}
          {order.city ? `, ${order.city}` : ""}
        </p>
      </div>

      <div className="space-y-3">
        <Link href={paths.track(order.orderId)} className="w-full h-11 bg-emerald-500 hover:bg-emerald-600 text-black text-xs uppercase tracking-widest font-bold rounded-xl flex items-center justify-center gap-2 transition-colors">
          <Search className="w-4 h-4" />
          Track Order
        </Link>
        <Link href={paths.home} className="w-full h-11 bg-white hover:bg-white/90 text-black text-xs uppercase tracking-widest font-bold rounded-xl flex items-center justify-center gap-2 transition-colors">
          <ShoppingBag className="w-4 h-4" />
          Continue Shopping
        </Link>
      </div>
    </div>
  );
}

/** A new tab has nothing to read the order with, so the customer proves it is theirs with the number they ordered from. */
function AskForDetails({ lookup }: { lookup: ReturnType<typeof useOrderLookup> }) {
  const searching = lookup.status === "searching";
  const message =
    lookup.errors.orderId ??
    lookup.errors.phone ??
    (lookup.status === "not_found"
      ? "No order matches this number and phone. Please check both and try again."
      : lookup.status === "error"
        ? lookup.failure?.kind === "rate_limited"
          ? "Too many attempts. Please wait a minute and try again."
          : "We could not check your order right now. Please try again."
        : null);
  const field = "w-full h-11 bg-white/10 border border-white/20 rounded-lg px-3.5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-white/60";

  return (
    <div className={card}>
      <div className="space-y-2 text-center">
        <h1 className="text-xl font-bold uppercase tracking-wider">View Your Order</h1>
        <p className="text-sm text-white/60">Enter your order number and the phone number you ordered with.</p>
      </div>
      <form
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void lookup.submit();
        }}
      >
        <div className="space-y-1.5">
          <label htmlFor="confirm-order" className="block text-xs text-white/70">Order number</label>
          <input id="confirm-order" type="text" autoComplete="off" value={lookup.values.orderId} onChange={(e) => lookup.setField("orderId", e.target.value)} className={field} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="confirm-phone" className="block text-xs text-white/70">Phone number</label>
          <input id="confirm-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0300 1234567" value={lookup.values.phone} onChange={(e) => lookup.setField("phone", e.target.value)} className={field} />
        </div>
        {message && <p role="alert" className="text-xs text-rose-300">{message}</p>}
        <button type="submit" disabled={searching} className="w-full h-11 bg-white text-black text-xs uppercase tracking-widest font-bold rounded-xl flex items-center justify-center gap-2 disabled:opacity-50">
          {searching && <Loader2 className="w-4 h-4 animate-spin" />}
          {searching ? "Checking..." : "View Order"}
        </button>
      </form>
    </div>
  );
}

function ConfirmationContent({ orderId }: { orderId: string }) {
  const confirmed = useConfirmedOrder(orderId);
  const lookup = useOrderLookup(orderId);
  const order = confirmed.order ?? lookup.order;

  return (
    <div className={shell}>
      {order ? (
        <OrderDetails order={order} />
      ) : confirmed.status === "loading" ? (
        <p className="text-sm text-gray-500">Loading your order...</p>
      ) : (
        <AskForDetails lookup={lookup} />
      )}
    </div>
  );
}

export function OrderConfirmationPage({ orderId }: OrderConfirmationPageProps) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white flex items-center justify-center text-black">Loading order confirmation...</div>}>
      <ConfirmationContent orderId={orderId} />
    </Suspense>
  );
}
