export interface TestimonialQuote {
  id: number;
  text: string;
}

export interface TestimonialsProps {
  heading: string;
  quotes: TestimonialQuote[];
}
