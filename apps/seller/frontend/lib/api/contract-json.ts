/**
 * Reads a JSON response and validates it against a contract parser (a zod schema satisfies
 * this shape). A body that does not match the contract throws, naming the endpoint, so a
 * backend drift fails loudly instead of rendering wrong data.
 */
export interface ContractParser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { message: string } };
}

export async function readContract<T>(response: Response, parser: ContractParser<T>): Promise<T> {
  const body: unknown = await response.json();
  const result = parser.safeParse(body);
  if (!result.success) {
    throw new Error('Unexpected response from ' + response.url + ': ' + result.error.message);
  }
  return result.data;
}
