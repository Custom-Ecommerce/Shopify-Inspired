"use client";

import type { AddressDetails } from "../../model";
import { paths } from "../../adapters/paths";
import { useStilettoCheckout } from "../../adapters/checkout";
import { firstErrorBox } from "../../adapters/checkout-fields";
import type { StilettoCheckoutField, StilettoFieldErrors } from "../../adapters/checkout-fields";
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  ExternalLink,
  Globe,
  Hash,
  MapPin,
  MessageSquare,
  Package,
  Phone,
  ShieldCheck,
  Truck,
  User,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import React, { useEffect, useState } from "react";
import { Button } from "../../shared/components/primitives/button";
import { parseNumericPrice, useCartContext } from "../../shared/context/CartContext";

export interface CheckoutSectionProps {
  deliveryCharges?: number;
  logoSrc?: string;
}

const formatCurrency = (amount: number) => {
  return `Rs. ${Math.round(amount).toLocaleString("en-PK")}`;
};

const createEmptyAddress = (): AddressDetails => ({
  firstName: "",
  lastName: "",
  address1: "",
  address2: "",
  city: "",
  zip: "",
  phone: "",
  country: "Pakistan",
});

const inputBaseClasses =
  "w-full h-11 bg-(--surface-inverse)/5 border border-(--surface-inverse)/10 rounded-xl pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder:text-(--text-primary)/30 focus:outline-none focus:border-(--surface-inverse)/40 transition-colors";
const labelBaseClasses =
  "text-xs text-(--text-primary)/70 tracking-wider uppercase font-medium";

const inputErrorClasses = "border-[var(--status-error-text)] focus:border-[var(--status-error-text)]";

/** The element id of the box a message belongs to. Only the shipping address carries messages. */
const fieldElementId = (field: StilettoCheckoutField): string => {
  if (field === "whatsapp") return "checkout-whatsapp";
  if (field === "notes") return "order-notes";
  return `shipping-${field}`;
};

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-[11px] text-[var(--status-error-text)]">
      {message}
    </p>
  );
}

interface DiscountCodeBoxProps {
  storedCode: string | null;
  appliedCode: string | null;
  error: string | null;
  busy: boolean;
  onApply: (code: string) => void;
  onRemove: () => void;
}

/** "Have a code?" in the order summary. It sits inside the checkout form, so nothing here may submit the order. */
function DiscountCodeBox({ storedCode, appliedCode, error, busy, onApply, onRemove }: DiscountCodeBoxProps) {
  const [opened, setOpened] = useState(false);
  const [text, setText] = useState("");

  useEffect(() => {
    if (storedCode) setText(storedCode);
  }, [storedCode]);

  if (appliedCode) {
    return (
      <div className="flex items-center justify-between gap-3 text-xs text-[var(--text-inverse)]">
        <span className="min-w-0 truncate">
          Code <span className="font-bold">{appliedCode}</span> applied
        </span>
        <button type="button" onClick={onRemove} className="shrink-0 underline underline-offset-2 text-(--text-inverse)/70 hover:text-[var(--text-inverse)]">
          Remove
        </button>
      </div>
    );
  }

  if (!opened && !storedCode) {
    return (
      <button type="button" onClick={() => setOpened(true)} className="text-xs underline underline-offset-2 text-(--text-inverse)/70 hover:text-[var(--text-inverse)]">
        Have a code?
      </button>
    );
  }

  const apply = () => {
    if (text.trim() !== "" && !busy) onApply(text);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <input
          type="text"
          aria-label="Discount code"
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={40}
          placeholder="Discount code"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter in a form field would place the order.
            if (e.key === "Enter") {
              e.preventDefault();
              apply();
            }
          }}
          className="min-w-0 flex-1 h-10 rounded-lg border border-(--text-inverse)/20 bg-(--surface-elevated)/5 px-3 text-xs uppercase text-[var(--text-inverse)] placeholder:normal-case placeholder:text-(--text-inverse)/40 focus:outline-none focus:border-(--text-inverse)/50"
        />
        <button type="button" onClick={apply} disabled={busy || text.trim() === ""} className="h-10 shrink-0 rounded-lg border border-(--text-inverse)/30 px-3 text-xs font-semibold text-[var(--text-inverse)] disabled:opacity-50">
          {busy ? "Checking…" : "Apply"}
        </button>
      </div>
      {error && (
        <div className="flex items-start justify-between gap-3 text-[11px] text-[var(--status-error-text)]">
          <p role="alert">{error}</p>
          <button type="button" onClick={onRemove} className="shrink-0 underline underline-offset-2">
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Reusable set of address input fields (First/Last name, Street Address,
 * Apartment, City, Zip, Phone, Country). Rendered once for the Shipping
 * Address and, conditionally, once more for the Billing Address — each
 * instance keeps its own `values`/`onChange` so the two addresses never
 * collide.
 */
interface AddressFieldsProps {
  idPrefix: string;
  values: AddressDetails;
  onChange: (field: keyof AddressDetails, value: string) => void;
  /** Messages for this address's boxes. The billing address is not sent, so it has none. */
  errors?: StilettoFieldErrors;
}

function AddressFields({ idPrefix, values, onChange, errors = {} }: AddressFieldsProps) {
  const handleChange =
    (field: keyof AddressDetails) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(field, e.target.value);
    };

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-firstName`} className={labelBaseClasses}>
            First Name *
          </label>
          <div className="relative flex items-center">
            <User className="w-4 h-4 absolute left-3.5 text-(--text-primary)/40 pointer-events-none" />
            <input
              id={`${idPrefix}-firstName`}
              type="text"
              name={`${idPrefix}-firstName`}
              required
              placeholder="First name"
              value={values.firstName}
              onChange={handleChange("firstName")}
              aria-invalid={errors.firstName ? true : undefined}
              aria-describedby={errors.firstName ? `${idPrefix}-firstName-error` : undefined}
              className={errors.firstName ? `${inputBaseClasses} ${inputErrorClasses}` : inputBaseClasses}
            />
          </div>
          <FieldError id={`${idPrefix}-firstName-error`} message={errors.firstName} />
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-lastName`} className={labelBaseClasses}>
            Last Name *
          </label>
          <div className="relative flex items-center">
            <User className="w-4 h-4 absolute left-3.5 text-(--text-primary)/40 pointer-events-none" />
            <input
              id={`${idPrefix}-lastName`}
              type="text"
              name={`${idPrefix}-lastName`}
              required
              placeholder="Last name"
              value={values.lastName}
              onChange={handleChange("lastName")}
              aria-invalid={errors.lastName ? true : undefined}
              aria-describedby={errors.lastName ? `${idPrefix}-lastName-error` : undefined}
              className={errors.lastName ? `${inputBaseClasses} ${inputErrorClasses}` : inputBaseClasses}
            />
          </div>
          <FieldError id={`${idPrefix}-lastName-error`} message={errors.lastName} />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-address1`} className={labelBaseClasses}>
          Street Address / House No. *
        </label>
        <div className="relative flex items-center">
          <MapPin className="w-4 h-4 absolute left-3.5 text-(--text-primary)/40 pointer-events-none" />
          <input
            id={`${idPrefix}-address1`}
            type="text"
            name={`${idPrefix}-address1`}
            required
            placeholder="House/Apartment #, Street name, Area"
            value={values.address1}
            onChange={handleChange("address1")}
            aria-invalid={errors.address1 ? true : undefined}
            aria-describedby={errors.address1 ? `${idPrefix}-address1-error` : undefined}
            className={errors.address1 ? `${inputBaseClasses} ${inputErrorClasses}` : inputBaseClasses}
          />
        </div>
        <FieldError id={`${idPrefix}-address1-error`} message={errors.address1} />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-address2`} className={labelBaseClasses}>
          Apartment, Suite, etc. (Optional)
        </label>
        <div className="relative flex items-center">
          <Building2 className="w-4 h-4 absolute left-3.5 text-(--text-primary)/40 pointer-events-none" />
          <input
            id={`${idPrefix}-address2`}
            type="text"
            name={`${idPrefix}-address2`}
            placeholder="Apartment, floor, landmark, etc."
            value={values.address2 ?? ""}
            onChange={handleChange("address2")}
            className={inputBaseClasses}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-city`} className={labelBaseClasses}>
            City *
          </label>
          <div className="relative flex items-center">
            <Building2 className="w-4 h-4 absolute left-3.5 text-(--text-primary)/40 pointer-events-none" />
            <input
              id={`${idPrefix}-city`}
              type="text"
              name={`${idPrefix}-city`}
              required
              placeholder="Karachi, Lahore, etc."
              value={values.city}
              onChange={handleChange("city")}
              aria-invalid={errors.city ? true : undefined}
              aria-describedby={errors.city ? `${idPrefix}-city-error` : undefined}
              className={errors.city ? `${inputBaseClasses} ${inputErrorClasses}` : inputBaseClasses}
            />
          </div>
          <FieldError id={`${idPrefix}-city-error`} message={errors.city} />
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-zip`} className={labelBaseClasses}>
            Postal / Zip Code (Optional)
          </label>
          <div className="relative flex items-center">
            <Hash className="w-4 h-4 absolute left-3.5 text-(--text-primary)/40 pointer-events-none" />
            <input
              id={`${idPrefix}-zip`}
              type="text"
              name={`${idPrefix}-zip`}
              placeholder="75500"
              value={values.zip ?? ""}
              onChange={handleChange("zip")}
              className={inputBaseClasses}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-phone`} className={labelBaseClasses}>
            Phone Number *
          </label>
          <div className="relative flex items-center">
            <Phone className="w-4 h-4 absolute left-3.5 text-(--text-primary)/40 pointer-events-none" />
            <input
              id={`${idPrefix}-phone`}
              type="tel"
              name={`${idPrefix}-phone`}
              required
              placeholder="e.g. 0300 1234567"
              value={values.phone}
              onChange={handleChange("phone")}
              inputMode="tel"
              autoComplete="tel"
              aria-invalid={errors.phone ? true : undefined}
              aria-describedby={errors.phone ? `${idPrefix}-phone-error` : undefined}
              className={errors.phone ? `${inputBaseClasses} ${inputErrorClasses}` : inputBaseClasses}
            />
          </div>
          <FieldError id={`${idPrefix}-phone-error`} message={errors.phone} />
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${idPrefix}-country`} className={labelBaseClasses}>
            Country *
          </label>
          <div className="relative flex items-center">
            <Globe className="w-4 h-4 absolute left-3.5 text-(--text-primary)/40 pointer-events-none" />
            <input
              id={`${idPrefix}-country`}
              type="text"
              name={`${idPrefix}-country`}
              required
              placeholder="Pakistan"
              value={values.country}
              onChange={handleChange("country")}
              className={inputBaseClasses}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function CheckoutSection({
  logoSrc = "/theme-assets/stiletto/logo/logo.png",
}: CheckoutSectionProps) {
  const { cartItems } = useCartContext();
  const {
    subtotal,
    deliveryCharges,
    discount,
    storedCode,
    appliedCode,
    codeError,
    isCheckingCode,
    applyCode,
    removeCode,
    grandTotal,
    lineTotalOf,
    isSubmitting,
    isChecking,
    canRetryUnconfirmed,
    orderError,
    fieldErrors,
    focusTick,
    clearFieldError,
    submit,
  } = useStilettoCheckout();

  const [whatsapp, setWhatsapp] = useState("");
  const [notes, setNotes] = useState("");

  const [shippingAddress, setShippingAddress] = useState<AddressDetails>(
    createEmptyAddress()
  );
  const [billingAddress, setBillingAddress] = useState<AddressDetails>(
    createEmptyAddress()
  );
  const [sameAsShipping, setSameAsShipping] = useState(true);


  // Moves to the first box with a message, which on a phone can be a long way above the button.
  useEffect(() => {
    if (focusTick === 0) return;
    const first = firstErrorBox(fieldErrors);
    if (first) document.getElementById(fieldElementId(first))?.focus();
    // Only when new messages appear, not each time one is cleared.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick]);

  const handleShippingAddressChange = (
    field: keyof AddressDetails,
    value: string
  ) => {
    setShippingAddress((prev) => ({ ...prev, [field]: value }));
    if (field === "firstName" || field === "lastName" || field === "address1" || field === "city" || field === "phone") {
      clearFieldError(field);
    }
    if (field === "address2" || field === "zip") clearFieldError("address1");
  };

  const handleBillingAddressChange = (
    field: keyof AddressDetails,
    value: string
  ) => {
    setBillingAddress((prev) => ({ ...prev, [field]: value }));
  };

  const handleOrderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // A second press while the order is on its way does nothing: the button is disabled and useCheckout refuses it too.
    if (isSubmitting) return;

    if (cartItems.length === 0) {
      alert("Your cart is empty!");
      return;
    }

    await submit({ whatsapp, shippingAddress, billingAddress, sameAsShipping, notes });
  };

  return (
    <div data-source="partial" data-source-note="Cart, delivery charges and totals are live. The billing address is shown but not stored." data-section="checkout" className="min-h-screen bg-[var(--surface-elevated)] text-[var(--text-primary)] font-sans flex flex-col">
      {/* Black Navbar Header */}
      <div className="bg-[var(--surface-inverse)] text-[var(--text-inverse)] border-b border-[var(--surface-inverse)] sticky top-0 z-30 shrink-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-4 sm:gap-6">
            <Link href={paths.home} className="relative w-8 h-8 sm:w-10 sm:h-10 block shrink-0">
              <Image
                src={logoSrc}
                alt="Store Logo"
                fill
                sizes="40px"
                className="object-contain"
                priority
              />
            </Link>

            <Link
              href={paths.home}
              className="hidden md:flex items-center gap-2 text-xs uppercase tracking-widest text-(--text-inverse)/70 hover:text-[var(--text-inverse)] transition-colors border-l border-(--text-inverse)/20 pl-4 sm:pl-6"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Store</span>
            </Link>
          </div>

          <span className="text-xs uppercase tracking-[0.2em] font-bold text-[var(--text-inverse)]">
            CHECKOUT
          </span>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 md:py-8 w-full flex-1">
        <form
          noValidate
          onSubmit={handleOrderSubmit}
          className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch h-full lg:h-[calc(100vh-140px)]"
        >
          {/* Left Column: Customer Form */}
          <div className="lg:col-span-7 h-full overflow-y-auto pr-2 space-y-8 [scrollbar-width:thin] [scrollbar-color:rgba(0,0,0,0.2)_transparent]">
            <div className="space-y-4">
              <div className="flex items-center gap-2 border-b border-(--surface-inverse)/10 pb-3">
                <MessageSquare className="w-5 h-5 text-(--text-primary)/80" />
                <h2 className="text-sm uppercase tracking-[0.15em] font-semibold text-[var(--text-primary)]">
                  Contact Information
                </h2>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="checkout-whatsapp" className="text-xs text-(--text-primary)/70 tracking-wider uppercase font-medium">
                  Active WhatsApp Number *
                </label>
                <div className="relative flex items-center">
                  <MessageSquare className="w-4 h-4 absolute left-3.5 text-(--text-primary)/40 pointer-events-none" />
                  <input
                    id="checkout-whatsapp"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    name="whatsapp"
                    required
                    placeholder="e.g. 0300 1234567"
                    value={whatsapp}
                    onChange={(e) => {
                      setWhatsapp(e.target.value);
                      clearFieldError("whatsapp");
                      clearFieldError("phone");
                    }}
                    aria-invalid={fieldErrors.whatsapp ? true : undefined}
                    aria-describedby={fieldErrors.whatsapp ? "checkout-whatsapp-error" : undefined}
                    className={fieldErrors.whatsapp ? `${inputBaseClasses} ${inputErrorClasses}` : inputBaseClasses}
                  />
                </div>
                <FieldError id="checkout-whatsapp-error" message={fieldErrors.whatsapp} />
                <p className="text-[11px] text-(--text-primary)/50">
                  Order status & dispatch updates will be sent to this WhatsApp number.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2 border-b border-(--surface-inverse)/10 pb-3">
                <MapPin className="w-5 h-5 text-(--text-primary)/80" />
                <h2 className="text-sm uppercase tracking-[0.15em] font-semibold text-[var(--text-primary)]">
                  Shipping Address
                </h2>
              </div>

              <AddressFields
                idPrefix="shipping"
                values={shippingAddress}
                onChange={handleShippingAddressChange}
                errors={fieldErrors}
              />
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2 border-b border-(--surface-inverse)/10 pb-3">
                <div className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-(--text-primary)/80" />
                  <h2 className="text-sm uppercase tracking-[0.15em] font-semibold text-[var(--text-primary)]">
                    Billing Address
                  </h2>
                </div>
              </div>

              <label
                htmlFor="same-as-shipping"
                className="flex items-center gap-2.5 p-3.5 bg-(--surface-inverse)/5 border border-(--surface-inverse)/10 rounded-xl cursor-pointer select-none"
              >
                <input
                  id="same-as-shipping"
                  type="checkbox"
                  checked={sameAsShipping}
                  onChange={(e) => setSameAsShipping(e.target.checked)}
                  className="w-4 h-4 rounded border-(--surface-inverse)/30 accent-[var(--surface-inverse)] cursor-pointer"
                />
                <span className="text-xs sm:text-sm font-medium text-[var(--text-primary)]">
                  Billing address same as shipping address
                </span>
              </label>

              {!sameAsShipping && (
                <div className="pt-1">
                  <AddressFields
                    idPrefix="billing"
                    values={billingAddress}
                    onChange={handleBillingAddressChange}
                  />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="order-notes" className={labelBaseClasses}>
                Order Notes (Optional)
              </label>
              <textarea
                id="order-notes"
                name="notes"
                rows={3}
                placeholder="Delivery instructions, landmark, or anything else we should know"
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  clearFieldError("notes");
                }}
                aria-invalid={fieldErrors.notes ? true : undefined}
                aria-describedby={fieldErrors.notes ? "order-notes-error" : undefined}
                className={`w-full bg-(--surface-inverse)/5 border border-(--surface-inverse)/10 rounded-xl px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-(--text-primary)/30 focus:outline-none focus:border-(--surface-inverse)/40 transition-colors resize-none ${fieldErrors.notes ? inputErrorClasses : ""}`}
              />
              <FieldError id="order-notes-error" message={fieldErrors.notes} />
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2 border-b border-(--surface-inverse)/10 pb-3">
                <Truck className="w-5 h-5 text-(--text-primary)/80" />
                <h2 className="text-sm uppercase tracking-[0.15em] font-semibold text-[var(--text-primary)]">
                  Payment Method
                </h2>
              </div>

              <div className="p-4 bg-(--surface-inverse)/5 border border-(--surface-inverse)/10 rounded-xl flex items-start gap-3">
                <div className="mt-0.5 w-4 h-4 rounded-full border-2 border-[var(--surface-inverse)] flex items-center justify-center shrink-0">
                  <div className="w-2 h-2 rounded-full bg-[var(--surface-inverse)]" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold tracking-wide text-[var(--text-primary)]">
                      Cash on Delivery (COD)
                    </span>
                    <span className="text-[10px] uppercase font-bold bg-[var(--surface-inverse)] text-[var(--text-inverse)] px-2 py-0.5 rounded">
                      Default
                    </span>
                  </div>
                  <p className="text-xs text-(--text-primary)/60 leading-relaxed">
                    Pay in cash when your parcel is delivered to your doorstep. No advance payment required.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Order Summary */}
          <div className="lg:col-span-5 h-full">
            <div className="bg-[var(--surface-inverse)] text-[var(--text-inverse)] rounded-2xl p-5 sm:p-6 border border-[var(--surface-inverse)] shadow-2xl h-full flex flex-col justify-between">
              <div className="flex flex-col flex-1 min-h-0 space-y-4">
                <div className="flex items-center justify-between border-b border-(--text-inverse)/10 pb-3 shrink-0">
                  <div className="flex items-center gap-2">
                    <Package className="w-5 h-5 text-(--text-inverse)/80" />
                    <h2 className="text-sm uppercase tracking-[0.15em] font-semibold">
                      Order Summary ({cartItems.length})
                    </h2>
                  </div>
                </div>

                {cartItems.length === 0 ? (
                  <p className="text-xs text-(--text-inverse)/50 italic py-8 text-center">
                    Your cart is currently empty.
                  </p>
                ) : (
                  <div className="flex-1 min-h-0 overflow-y-auto pr-2 space-y-3.5 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.2)_transparent]">
                    {cartItems.map((item) => {
                      const itemUnitPrice = item.numericPrice || parseNumericPrice(item.price);
                      // The server's line total once it has answered; the cart's own price can be out of date.
                      const itemTotalPrice = lineTotalOf(item.productId, item.variantId) ?? itemUnitPrice * item.quantity;
                      const itemHandle = (item as { handle?: string }).handle;
                      const productHref = itemHandle ? paths.product(itemHandle) : "#";

                      return (
                        <div
                          key={item.lineId}
                          className="flex gap-3.5 items-center p-3 bg-(--surface-elevated)/5 border border-(--text-inverse)/10 rounded-xl group hover:border-(--text-inverse)/30 transition-colors shrink-0"
                        >
                          <div className="relative w-16 h-20 bg-(--surface-elevated)/10 rounded-lg overflow-hidden shrink-0">
                            <Image
                              src={item.image}
                              alt={item.title}
                              fill
                              sizes="64px"
                              className="object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          </div>

                          <div className="flex-1 min-w-0 flex flex-col justify-between h-full py-0.5">
                            <div>
                              <h4 className="text-xs font-medium text-[var(--text-inverse)] truncate">
                                {item.title}
                              </h4>
                              <p className="text-[11px] text-(--text-inverse)/50 mt-0.5">
                                Qty: {item.quantity} {item.variantTitle ? `| ${item.variantTitle}` : item.size ? `| Size: ${item.size}` : ""}
                              </p>
                            </div>

                            <div className="flex items-center justify-between mt-2 pt-1">
                              <p className="text-xs font-bold text-(--text-inverse)/90">
                                {formatCurrency(itemTotalPrice)}
                              </p>

                              <Link
                                href={productHref}
                                target="_blank"
                                className="text-[10px] text-(--text-inverse)/60 hover:text-[var(--text-inverse)] flex items-center gap-1 uppercase tracking-wider font-semibold transition-colors"
                              >
                                View Product
                                <ExternalLink className="w-3 h-3" />
                              </Link>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Subtotal & Action Footer */}
              <div className="space-y-3 pt-3 border-t border-(--text-inverse)/10 shrink-0 mt-3">
                {orderError && (
                  <div className="p-3 bg-(--status-error-solid)/10 border border-(--status-error-solid)/30 rounded-xl flex items-start gap-2 text-[var(--status-error-text)] text-xs">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{orderError}</span>
                  </div>
                )}

                {cartItems.length > 0 && (
                  <DiscountCodeBox
                    storedCode={storedCode}
                    appliedCode={appliedCode}
                    error={codeError}
                    busy={isCheckingCode}
                    onApply={applyCode}
                    onRemove={removeCode}
                  />
                )}

                <div className="space-y-1.5 text-xs text-(--text-inverse)/70">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span className="text-[var(--text-inverse)] font-medium">{formatCurrency(subtotal)}</span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="flex items-center gap-1.5">
                      <Truck className="w-3.5 h-3.5 text-(--text-inverse)/50" />
                      Delivery Charges
                    </span>
                    <span className="text-[var(--text-inverse)] font-medium">
                      {cartItems.length > 0 ? formatCurrency(deliveryCharges) : "Rs. 0"}
                    </span>
                  </div>

                  {discount > 0 && (
                    <div className="flex justify-between items-center">
                      <span>Discount{appliedCode ? ` (${appliedCode})` : ""}</span>
                      <span className="text-[var(--text-inverse)] font-medium">-{formatCurrency(discount)}</span>
                    </div>
                  )}

                  <div className="flex justify-between items-center pt-2 border-t border-(--text-inverse)/10 text-sm font-bold text-[var(--text-inverse)]">
                    <span>Total Amount</span>
                    <span className="text-lg font-bold">{formatCurrency(grandTotal)}</span>
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={isSubmitting || cartItems.length === 0}
                  className="w-full h-11 bg-[var(--surface-elevated)] text-[var(--text-primary)] font-sans text-xs uppercase tracking-[0.15em] font-bold rounded-xl hover:bg-(--surface-elevated)/90 transition-all disabled:opacity-50"
                >
                  {isChecking ? "We are checking your order…" : isSubmitting ? "Processing Order..." : canRetryUnconfirmed ? "Try Again" : "Place Order (COD)"}
                </Button>

                <div className="flex items-center justify-center gap-2 text-[10px] text-(--text-inverse)/40">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>100% Safe & Secure Cash on Delivery</span>
                </div>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}