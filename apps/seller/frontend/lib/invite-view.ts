/**
 * Sprint 8 (S8-B2, D-118): the accept-invite page. Pure: what the page shows for a token, the links to sign in or create the account and come back, and the words. No React,
 * no fetch. The server decides everything that matters (the token, its expiry, the email match); nothing here is trusted. An invite that is unknown, expired, used or for
 * another account is ONE answer from the server, so the page never says which of those it was.
 */

export type InviteRole = "manager" | "staff" | "support";

/** What GET /api/team/invite answers: the store, the role and the invited email for a valid token, else { valid: false }. */
export type InviteInfo = { valid: true; storeName: string; role: InviteRole; email: string } | { valid: false };

/** The invite token has the shape of 32 random bytes in base64url: 43 characters. Anything else is never sent. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export const isInviteToken = (value: unknown): value is string => typeof value === "string" && TOKEN_SHAPE.test(value);

export type InviteView =
  | { kind: "loading" }
  /** No token in the link, or one that cannot be a token, or the server said it is not valid (unknown, expired, used or cancelled: one answer). */
  | { kind: "invalid" }
  | { kind: "sign_in"; storeName: string; role: InviteRole; email: string }
  | { kind: "ready"; storeName: string; role: InviteRole; email: string }
  | { kind: "wrong_account"; storeName: string; role: InviteRole; email: string; signedInAs: string }
  | { kind: "accepted"; storeName: string; role: InviteRole; storeId?: string }
  | { kind: "error"; message: string };

export interface InviteInput {
  token: string | null;
  /** null while it is being asked; "error" when the server could not be reached. */
  info: InviteInfo | null | "error";
  /** The signed-in account's email, "none" when there is no session, null while it is being asked. */
  account: string | "none" | null;
  accepted: { storeName: string; role: InviteRole; storeId?: string } | null;
}

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The one decision the page renders. Order matters: an accepted invite stays accepted whatever else is read after it. */
export function decideInviteView(input: InviteInput): InviteView {
  if (input.accepted !== null) return { kind: "accepted", ...input.accepted };
  if (!isInviteToken(input.token)) return { kind: "invalid" };
  if (input.info === "error") return { kind: "error", message: "Could not reach the server. Please reload the page." };
  if (input.info === null || input.account === null) return { kind: "loading" };
  if (!input.info.valid) return { kind: "invalid" };
  const { storeName, role, email } = input.info;
  if (input.account === "none") return { kind: "sign_in", storeName, role, email };
  return same(input.account, email) ? { kind: "ready", storeName, role, email } : { kind: "wrong_account", storeName, role, email, signedInAs: input.account };
}

export const ROLE_NAMES: Record<InviteRole, string> = { manager: "Manager", staff: "Staff", support: "Support" };

/** One plain line about what a role can do, so the invitee knows what they are accepting. */
export const ROLE_BLURBS: Record<InviteRole, string> = {
  manager: "Manager: runs the store day to day. Everything except payments, payouts, billing, the domain, API keys and the team, which stay with the owner.",
  staff: "Staff: works on orders, products and stock.",
  support: "Support: helps customers with orders, returns, reviews and messages.",
};

export const roleName = (role: unknown): string => (typeof role === "string" && role in ROLE_NAMES ? ROLE_NAMES[role as InviteRole] : "Team member");

// ---------------------------------------------------------------------------------------------------------- coming back after sign in

const NEXT_SHAPE = /^\/accept-invite\?token=[A-Za-z0-9_-]{43}$/;

/** Where to go after signing in: the invite page again, nothing else. Anything that is not exactly that path is ignored (no open redirect). */
export function safeNextPath(value: unknown): string | null {
  return typeof value === "string" && NEXT_SHAPE.test(value) ? value : null;
}

/** The invite path to come back to, for the login and signup links. */
export const invitePath = (token: string): string => "/accept-invite?token=" + token;

export const inviteLoginHref = (token: string): string => "/login?next=" + encodeURIComponent(invitePath(token));
export const inviteSignupHref = (token: string): string => "/signup?next=" + encodeURIComponent(invitePath(token));

/** The page to open after a successful sign in or sign up: the invite page when the address carries one (next=...), else the dashboard. `search` is location.search. */
export function nextAfterAuth(search: string): string {
  try {
    return safeNextPath(new URLSearchParams(search).get("next")) ?? "/";
  } catch {
    return "/";
  }
}

// ---------------------------------------------------------------------------------------------------------- signing up from an invite (SB-F1)

/** The invite token the signup page was opened with (?next=/accept-invite?token=...), or null for an ordinary signup. */
export function inviteTokenFromSearch(search: string): string | null {
  const next = nextAfterAuth(search);
  return next === "/" ? null : next.slice(next.indexOf("=") + 1);
}

/** What the signup page takes from the invite lookup: the invited address and the store. Null for anything but a valid invite. */
export interface SignupInvite {
  email: string;
  storeName: string;
}

export function signupInviteFrom(body: unknown): SignupInvite | null {
  const info = (typeof body === "object" && body !== null ? body : {}) as { valid?: unknown; email?: unknown; storeName?: unknown };
  return info.valid === true && typeof info.email === "string" && info.email !== "" && typeof info.storeName === "string" ? { email: info.email, storeName: info.storeName } : null;
}

export const SIGNUP_TITLE = "Start selling";
export const SIGNUP_TEXT = "Create your account — you will set up your store next.";
export const SIGNUP_INVITE_TITLE = "Join the team";

/** A team member is joining someone's store: they are not told they will set one up. */
export const signupWords = (invite: SignupInvite | null): { title: string; text: string } =>
  invite === null ? { title: SIGNUP_TITLE, text: SIGNUP_TEXT } : { title: SIGNUP_INVITE_TITLE, text: `Create your account to join ${invite.storeName}.` };

// ---------------------------------------------------------------------------------------------------------- the words

export const INVALID_TITLE = "This invitation is not valid";
export const INVALID_TEXT = "It may have expired, been used already, or been cancelled. Ask the store owner to send you a new one.";
