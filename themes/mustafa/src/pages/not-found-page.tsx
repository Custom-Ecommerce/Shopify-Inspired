import Link from "next/link";
import { storePaths } from "@markaz/storefront-data";
import type { NotFoundPageProps } from "@markaz/storefront-data";
import { StatusPanel } from "../components/status-panel";
import { buttonVariants } from "../components/ui/button";

export function NotFoundPage(_props: NotFoundPageProps) {
  return (
    <StatusPanel
      title="Page not found"
      action={
        <Link href={storePaths.catalog} className={buttonVariants({ size: "lg" })}>
          Browse products
        </Link>
      }
    >
      We could not find what you were looking for.
    </StatusPanel>
  );
}
