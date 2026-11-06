// ============================================================================
// calculateReviewSummary
// ----------------------------------------------------------------------------
// Derives the aggregate rating summary (average rating + total count) for a
// product's review list. Extracted from
// packages/theme/src/themes/stiletto/components/product-detail/ProductReviewsSection.tsx
// so the calculation is shared, pure, and unit-testable outside the component.
// ============================================================================

import type { ReviewItem } from "../../../../model";

export interface ReviewSummary {
  totalReviews: number;
  averageRating: string;
}

export function calculateReviewSummary(reviews: ReviewItem[] = []): ReviewSummary {
  const totalReviews = reviews.length;

  const averageRating =
    totalReviews > 0
      ? (reviews.reduce((acc, r) => acc + (r.rating || 5), 0) / totalReviews).toFixed(1)
      : "0.0";

  return { totalReviews, averageRating };
}
