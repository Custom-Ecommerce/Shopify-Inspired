/** The wait the seller is told on a 429: Retry-After (seconds) rounded up to whole minutes, at least one. */
export function tooManyAttemptsMessage(retryAfter: string | null | undefined): string {
  const seconds = Number(retryAfter ?? "0");
  const minutes = Math.max(1, Math.ceil((Number.isFinite(seconds) ? seconds : 0) / 60));
  return `Too many attempts. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
