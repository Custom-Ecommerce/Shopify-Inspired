"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Surface } from "@/components/shared/Surface";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { useActiveStoreId, useStoreHref } from "@/lib/dashboard-context";

export function OnboardingChecklist({
  hasProducts,
  hasDomain,
  hasLogo,
  hasWhatsApp,
}: {
  hasProducts: boolean;
  hasDomain: boolean;
  hasLogo: boolean;
  hasWhatsApp: boolean;
}) {
  const storeId = useActiveStoreId();
  const href = useStoreHref();
  // Per-store dismissal (Blueprint §6.7): dismissing the guide for one store
  // must not hide it for the seller's other stores.
  const dismissKey = `markaz-onboarding-dismissed:${storeId}`;
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem(dismissKey) === "true");
  }, [dismissKey]);

  const steps = [
    { done: hasProducts, label: "Add your first product", cta: "Add Product", href: href("/products/new") },
    { done: hasDomain, label: "Connect a custom domain", cta: "Connect Domain", href: href("/domain") },
    { done: hasLogo, label: "Upload a store logo", cta: "Add Logo", href: href("/store") },
    { done: hasWhatsApp, label: "Add a WhatsApp number", cta: "Add WhatsApp", href: href("/store") },
  ];
  const completedCount = steps.filter((s) => s.done).length;

  if (dismissed || completedCount === steps.length) return null;

  function dismiss() {
    localStorage.setItem(dismissKey, "true");
    setDismissed(true);
  }

  return (
    <Surface
      variant="clay"
      level={2}
      radius="2xl"
      className="border-l-4 border-l-primary p-5 sm:p-6"
    >
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="font-heading text-base font-semibold text-foreground sm:text-lg">
            Store Setup Guide
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Complete these steps to get your store ready for customers.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={dismiss} className="-mr-1 -mt-1">
          Dismiss
        </Button>
      </div>

      <Progress
        value={(completedCount / steps.length) * 100}
        className="mb-5 h-2"
      />

      <div className="flex flex-col gap-3">
        {steps.map((step, i) => (
          <div key={step.label} className="flex items-center gap-3">
            {/* Step dot: semantic tokens instead of bg-green-100 */}
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                step.done
                  ? "bg-success/15 text-success"
                  : "bg-muted text-muted-foreground"
              )}
              aria-hidden="true"
            >
              {step.done ? <Check className="size-3.5" strokeWidth={2.5} /> : i + 1}
            </span>

            <p
              className={cn(
                "flex-1 text-sm",
                step.done ? "text-muted-foreground line-through" : "font-medium text-foreground"
              )}
            >
              {step.label}
            </p>

            {!step.done && (
              <Button
                size="sm"
                variant={i === 0 ? "clay" : "clay-soft"}
                render={<Link href={step.href} />}
                className="shrink-0"
              >
                {step.cta}
              </Button>
            )}
          </div>
        ))}
      </div>
    </Surface>
  );
}
