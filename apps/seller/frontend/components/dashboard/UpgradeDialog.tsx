"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PLAN_LIMIT_EVENT, upgradeSummary, upgradeTitle, type PlanLimitInfo } from "@/lib/plan-usage";

/**
 * Sprint 6 EP-14.US02 (D-118): the upgrade hint, opened when a request answers 403 PLAN_LIMIT_REACHED. Plain text only: the hint comes from the
 * server and is rendered as text, never as markup. Nothing was lost: the dialog says what the plan allows and where to upgrade.
 */
export function UpgradeDialog({ info, onClose, billingHref }: { info: PlanLimitInfo | null; onClose: () => void; billingHref: string | null }) {
  return (
    <Dialog open={info !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md" data-slot="upgrade-dialog">
        {info !== null ? (
          <>
            <DialogHeader>
              <DialogTitle>{upgradeTitle(info)}</DialogTitle>
              <DialogDescription>{upgradeSummary(info)}</DialogDescription>
            </DialogHeader>
            <p className="text-sm" data-slot="upgrade-hint">
              {info.upgradeHint}
            </p>
            <p className="text-xs text-muted-foreground">Your existing {info.limitKind === "stores" ? "stores" : "products"} are safe: you can still edit and delete them.</p>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" className="min-h-11" onClick={onClose}>
                Not now
              </Button>
              {billingHref !== null ? (
                <Button className="min-h-11" render={<Link href={billingHref} onClick={onClose} />} nativeButton={false}>
                  See plans and billing
                </Button>
              ) : null}
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Mounted once in the store dashboard layout: listens for a refused add anywhere (product form, duplicate, restore) and opens the dialog. */
export function UpgradeDialogHost({ billingHref }: { billingHref: string }) {
  const [info, setInfo] = useState<PlanLimitInfo | null>(null);
  useEffect(() => {
    const listener = (event: Event) => setInfo((event as CustomEvent<PlanLimitInfo>).detail);
    window.addEventListener(PLAN_LIMIT_EVENT, listener);
    return () => window.removeEventListener(PLAN_LIMIT_EVENT, listener);
  }, []);
  return <UpgradeDialog info={info} onClose={() => setInfo(null)} billingHref={billingHref} />;
}
