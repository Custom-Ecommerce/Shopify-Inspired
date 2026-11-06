/** "1 item" or "3 items": a count with the noun in the form that matches it. */
export function countLabel(count: number, singular: string, plural: string): string {
  return count + " " + (count === 1 ? singular : plural);
}
