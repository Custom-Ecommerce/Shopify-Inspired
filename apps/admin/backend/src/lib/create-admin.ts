/*
 * Sprint 4 EP-08.US05.T02 (CO-05): create the first platform operator. The logic is here, with the User model and the
 * hasher passed in, so it is tested without a database; scripts/create-admin.mjs only reads input and connects.
 * Nothing here prints or returns the password or its hash.
 */

interface LeanQuery<T> {
  lean(): PromiseLike<T>;
}

export interface AdminUserModelPort {
  exists(filter: Record<string, unknown>): PromiseLike<unknown>;
  findOne(filter: Record<string, unknown>): { select(fields: string): LeanQuery<unknown> };
  create(doc: Record<string, unknown>): PromiseLike<unknown>;
}

export interface CreateAdminInput {
  email: string;
  password: string;
  name?: string;
  force?: boolean;
}

export type CreateAdminResult =
  | { ok: true; id: string; email: string }
  | { ok: false; reason: 'ADMIN_EXISTS' | 'EMAIL_TAKEN' | 'INVALID_EMAIL' | 'INVALID_PASSWORD'; message: string };

const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;

export async function createFirstAdmin(
  users: AdminUserModelPort,
  input: CreateAdminInput,
  deps: { hashPassword(plain: string): Promise<string>; passwordProblem(value: unknown): string | null; now?: () => Date },
): Promise<CreateAdminResult> {
  const email = input.email.trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return { ok: false, reason: 'INVALID_EMAIL', message: 'ADMIN_EMAIL is not a valid email address.' };
  const problem = deps.passwordProblem(input.password);
  if (problem !== null) return { ok: false, reason: 'INVALID_PASSWORD', message: 'The password is not accepted: ' + problem + '.' };

  if (!input.force && (await users.exists({ role: 'admin' }))) {
    return { ok: false, reason: 'ADMIN_EXISTS', message: 'An admin account already exists. Run again with --force to add another one.' };
  }
  if (await users.findOne({ email }).select('_id').lean()) {
    return { ok: false, reason: 'EMAIL_TAKEN', message: 'An account with this email already exists.' };
  }

  const passwordHash = await deps.hashPassword(input.password);
  const created = (await users.create({
    name: input.name?.trim() || 'Platform admin',
    email,
    role: 'admin',
    store: null,
    passwordHash,
    loginAttempts: 0,
    lockUntil: null,
    accountStatus: 'active',
    tokenVersion: 0,
    // The operator typed this address themselves on the server: it counts as verified.
    emailVerifiedAt: (deps.now ?? (() => new Date()))(),
  })) as { _id?: unknown } | null;
  return { ok: true, id: String(created?._id ?? ''), email };
}
