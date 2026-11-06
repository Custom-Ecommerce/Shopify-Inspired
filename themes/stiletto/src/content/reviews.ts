import type { ReviewItem } from "../model";

/** Sample reviews. The platform has no review list yet, so every store shows these, badged STATIC. */
export const sampleReviews: ReviewItem[] = [
  { id: "sample-1", author: "Ayesha K.", rating: 5, date: "12 Mar 2026", comment: "Soft fabric, true to size and discreet packaging. Exactly what I hoped for." },
  { id: "sample-2", author: "Sana R.", rating: 4, date: "28 Feb 2026", comment: "Comfortable all day and the stitching feels sturdy. Delivery was quick." },
  { id: "sample-3", author: "Hira M.", rating: 5, date: "04 Feb 2026", comment: "Great quality for the price. I have already ordered a second set." },
];

/** Photos shown on the feedback page when no product is selected. */
export const feedbackImages: string[] = [
  "https://images.unsplash.com/photo-1568663521381-33b7c467fda0?w=700&auto=format&fit=crop&q=70",
  "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=700&q=70",
  "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=700&q=70",
  "https://images.unsplash.com/photo-1591369822096-ffd140ec948f?auto=format&fit=crop&w=700&q=70",
];
