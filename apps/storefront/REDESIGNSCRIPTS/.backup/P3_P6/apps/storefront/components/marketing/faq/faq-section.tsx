import { FAQS } from "@/content/marketing/faqs";
import { Section } from "@/components/shared/section";
import { SectionHeading } from "@/components/shared/section-heading";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Reveal } from "@/components/shared/reveal";
import { MessageCircle } from "lucide-react";

export function FaqSection() {
  return (
    <Section id="faq" labelledBy="faq-heading" tone="muted">
      <div className="flex flex-col lg:flex-row gap-12 lg:gap-24 items-start w-full">
        
        <div className="flex flex-col lg:sticky lg:top-28 self-start w-full lg:w-[40%]">
          <SectionHeading 
            id="faq-heading"
            eyebrow="Questions?"
            title="Frequently asked questions"
            lead="Everything you need to know about the product and billing. Can't find your answer? Contact our team."
            align="start"
          />
          <a href="/contact" className="inline-flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-sm w-fit -mt-4">
            <MessageCircle className="size-4 text-primary" aria-hidden="true" />
            Contact support
          </a>
        </div>
        
        <div className="flex-1 w-full">
          <Reveal>
            <Accordion defaultValue={["item-1", "item-2"]} className="w-full">
              {FAQS.map((faq) => (
                <AccordionItem key={faq.id} value={faq.id} className="border-b border-border">
                  <AccordionTrigger className="text-left text-lg font-semibold hover:text-primary transition-colors min-h-14 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm">
                    {faq.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground leading-relaxed">
                    {faq.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Reveal>
        </div>
        
      </div>
    </Section>
  );
}
