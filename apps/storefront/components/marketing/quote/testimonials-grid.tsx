import { Card } from "@/components/shared/card";
import { TESTIMONIALS } from "@/content/marketing/testimonials";

/**
 * Testimonials grid. Renders nothing until TESTIMONIALS holds approved entries (decision D7).
 * It is not rendered on any page yet.
 */
export function TestimonialsGrid() {
  if (TESTIMONIALS.length === 0) return null;

  return (
    <ul className="grid grid-cols-1 gap-6 md:grid-cols-3">
      {TESTIMONIALS.map((item) => (
        <li key={item.id}>
          <Card as="article" padding="responsive" className="flex h-full flex-col justify-between gap-6">
            <p className="text-base leading-relaxed text-foreground">{item.quote}</p>
            <p className="text-sm">
              <span className="block font-semibold text-foreground">{item.name}</span>
              <span className="block text-muted-foreground">{item.store}</span>
            </p>
          </Card>
        </li>
      ))}
    </ul>
  );
}
