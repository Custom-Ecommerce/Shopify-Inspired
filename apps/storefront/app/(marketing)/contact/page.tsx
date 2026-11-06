import { PageHeader } from "@/components/marketing/layout/page-header";
import { ContactForm } from "@/components/marketing/contact/contact-form";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Contact",
  description:
    "Send Markazify a message about selling online, Cash on Delivery, local payments or your store. Write to us in Urdu or English.",
  path: "/contact",
});

export default function ContactPage() {
  return (
    <>
      <PageHeader
        title="Contact us"
        lead="Ask about selling online, Cash on Delivery, payments or your store. Fill in the form below and send us your message."
      />
      <div className="mx-auto w-full max-w-2xl px-4 pb-(--section-y) sm:px-6 lg:px-8">
        <ContactForm />
      </div>
    </>
  );
}
