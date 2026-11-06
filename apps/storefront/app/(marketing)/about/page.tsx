import { PageHeader } from "@/components/marketing/layout/page-header";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "About",
  description:
    "About Markazify, an online store platform for sellers in Pakistan. Cash on Delivery, WhatsApp order checks, JazzCash and EasyPaisa are built in.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <>
      <PageHeader
        title="About Markazify"
        lead="Markazify helps sellers in Pakistan open an online store with Cash on Delivery, local payments and courier tools built in."
      />
      <div className="mx-auto w-full max-w-3xl px-4 pb-(--section-y) sm:px-6 lg:px-8">
        <div className="space-y-5 text-lead leading-relaxed text-muted-foreground">
          <p>
            Our goal is simple: give sellers a store that looks good on a phone, and the tools to take orders, so they can
            focus on their brand and their customers.
          </p>
          <p>
            Markazify is built around how people shop in Pakistan. That means Cash on Delivery with WhatsApp order
            confirmation, JazzCash and EasyPaisa, and prices in rupees.
          </p>
        </div>
      </div>
    </>
  );
}
