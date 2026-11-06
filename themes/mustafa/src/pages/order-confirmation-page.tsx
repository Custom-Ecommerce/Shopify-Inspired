import Link from "next/link";
import { storePaths } from "@markaz/storefront-data";
import type { OrderConfirmationPageProps } from "@markaz/storefront-data";
import { StatusPanel } from "../components/status-panel";
import { buttonVariants } from "../components/ui/button";
import { CheckIcon } from "../components/ui/icons";

export function OrderConfirmationPage({ orderId }: OrderConfirmationPageProps) {
  return (
    <StatusPanel
      title="Thank you for your order"
      icon={
        <span className="flex size-14 items-center justify-center rounded-full bg-(--mu-success-bg) text-(color:--mu-success)">
          <CheckIcon className="size-7" />
        </span>
      }
      action={
        <>
          <Link href={storePaths.track(orderId)} className={buttonVariants({ size: "lg", variant: "secondary" })}>
            Track this order
          </Link>
          <Link href={storePaths.catalog} className={buttonVariants({ size: "lg" })}>
            Continue shopping
          </Link>
        </>
      }
    >
      <p>
        Your order reference is <strong className="font-semibold text-(color:--mu-fg)">{orderId}</strong>. Keep it
        handy, because you will need it and your phone number to track the order.
      </p>
    </StatusPanel>
  );
}
