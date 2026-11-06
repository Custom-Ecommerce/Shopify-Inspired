/** A class-name value. Falsy values are dropped, so conditional classes can be written inline. */
export type ClassValue = string | false | null | undefined;

/**
 * Joins class names. The theme carries no class-merge dependency, so each component orders its own
 * classes and callers pass overrides last.
 */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
