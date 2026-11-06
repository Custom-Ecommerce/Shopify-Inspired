import Link from "next/link";
import { storePaths } from "@markaz/storefront-data";
import type { UnavailablePageProps } from "@markaz/storefront-data";
import { StatusPanel } from "../components/status-panel";
import { Button, buttonVariants } from "../components/ui/button";

/**
 * The page for a store, or one part of it, that cannot load right now. A server page passes retryHref, a link back to
 * the page that failed. A client error boundary passes onRetry, which re-renders the segment in place.
 */
export function UnavailablePage({ message, retryHref, onRetry }: UnavailablePageProps) {
  const body = message ?? "This store is temporarily unavailable. Please check back soon.";

  let action;
  if (onRetry) {
    action = (
      <Button size="lg" onClick={onRetry}>
        Try again
      </Button>
    );
  } else if (retryHref) {
    action = (
      <Link href={retryHref} className={buttonVariants({ size: "lg" })}>
        Try again
      </Link>
    );
  } else {
    action = (
      <Link href={storePaths.catalog} className={buttonVariants({ size: "lg" })}>
        Browse products
      </Link>
    );
  }

  return (
    <StatusPanel title="Temporarily unavailable" action={action}>
      {body}
    </StatusPanel>
  );
}
