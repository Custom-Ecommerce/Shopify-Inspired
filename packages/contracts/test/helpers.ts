
/** Dotted paths of every issue, so a test can assert the exact field that failed. */
export function failingPaths(result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } }): string[] {
  if (result.success || !result.error) return [];
  return result.error.issues.map((issue) => issue.path.map(String).join('.'));
}
