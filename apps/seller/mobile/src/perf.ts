/**
 * One number the owner can read on any phone, also in Expo Go: the time from the app's code starting to its first screen with data. It leaves out what
 * Android does before the code runs; docs/mobile-performance.md says how to measure that on an installed build.
 */
let startedAt = Date.now();
let firstScreenAfter: number | null = null;

export function markFirstScreen(now: number = Date.now()): void {
  firstScreenAfter ??= Math.max(0, now - startedAt);
}

export const startupMillis = (): number | null => firstScreenAfter;

/** Tests only. */
export function resetStartupClock(at: number): void {
  startedAt = at;
  firstScreenAfter = null;
}
