export interface AdminSeedInput {
  email: string;
  name: string;
  password: string;
}

/** Problems with the values for the first operator, or an empty list. The password rule is stricter than sign-in. */
export function validateAdminSeed(input: AdminSeedInput): string[] {
  const problems: string[] = [];
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) problems.push('email must be a valid address');
  if (input.name.trim().length < 2) problems.push('name must be at least 2 characters');
  if (input.password.length < 12) problems.push('password must be at least 12 characters');
  return problems;
}
