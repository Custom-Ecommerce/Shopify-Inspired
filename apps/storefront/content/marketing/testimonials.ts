/**
 * Testimonial structure. D7: the testimonials section stays hidden until real, approved
 * customer stories are supplied. Do not add placeholder people or quotes here.
 * TODO(assets): add approved testimonials (name, store, quote). Photos go in public/testimonials/.
 */
export interface TestimonialItem {
  id: string;
  quote: string;
  name: string;
  store: string;
  /** Optional public path, for example /testimonials/<name>.webp */
  photo?: string;
}

export const TESTIMONIALS: readonly TestimonialItem[] = [];
