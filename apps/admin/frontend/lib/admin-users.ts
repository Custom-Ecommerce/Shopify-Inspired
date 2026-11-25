import type { AdminUser } from "@/lib/contracts";

/**
 * Sprint 6 EP-20 (S6-B6, D-118): the Admin users page. Pure helpers: labels, the actions a row offers, the checks of the invite and reason forms. The
 * server decides (owner level only; the last owner is protected; nobody changes themselves); the console only follows and says why early.
 */

export const ADMIN_LEVEL_OPTIONS = [
  { value: "owner", label: "Owner", hint: "Everything, including admin users and the audit export." },
  { value: "finance", label: "Finance", hint: "Payments, payouts, commission and reports." },
  { value: "operations", label: "Operations", hint: "Sellers, stores, store limits, sync and settings (read)." },
  { value: "customer_support", label: "Customer support", hint: "Orders (read only), sellers (read), tickets and contact." },
] as const;
export type AdminLevelValue = (typeof ADMIN_LEVEL_OPTIONS)[number]["value"];

export const levelLabel = (level: string): string => ADMIN_LEVEL_OPTIONS.find((option) => option.value === level)?.label ?? level;
export type LevelTone = "default" | "success" | "warning" | "neutral";
export const levelTone = (level: string): LevelTone => (level === "owner" ? "default" : level === "finance" ? "success" : level === "operations" ? "warning" : "neutral");

export type UserAction = "level" | "disable" | "enable";

/** The actions a row offers. Never on yourself; the last active owner offers none (the server refuses both anyway). */
export function userActions(user: Pick<AdminUser, "id" | "adminLevel" | "accountStatus">, selfId: string, users: readonly Pick<AdminUser, "id" | "adminLevel" | "accountStatus">[]): UserAction[] {
  if (user.id === selfId) return [];
  const activeOwners = users.filter((u) => u.adminLevel === "owner" && u.accountStatus === "active");
  const lastOwner = user.adminLevel === "owner" && user.accountStatus === "active" && activeOwners.length <= 1;
  if (lastOwner) return [];
  return user.accountStatus === "active" ? ["level", "disable"] : ["enable", "level"];
}

export const REASON_MIN = 3;
export const REASON_MAX = 300;

export function reasonProblem(reason: string): string | null {
  const value = reason.trim();
  if (value.length < REASON_MIN) return "Give a reason of at least " + REASON_MIN + " characters.";
  if (value.length > REASON_MAX) return "The reason can be at most " + REASON_MAX + " characters.";
  if (/[<>]/.test(value)) return "Use plain text: < and > are not allowed.";
  return null;
}

export interface InviteForm {
  name: string;
  email: string;
  adminLevel: AdminLevelValue | "";
}
export type InviteProblems = Partial<Record<keyof InviteForm, string>>;

export function inviteProblems(form: InviteForm): InviteProblems {
  const problems: InviteProblems = {};
  const name = form.name.trim();
  if (name === "") problems.name = "Enter a name.";
  else if (name.length > 80) problems.name = "The name can be at most 80 characters.";
  else if (/[<>]/.test(name)) problems.name = "Use plain text: < and > are not allowed.";
  const email = form.email.trim();
  if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(email) || email.length > 254) problems.email = "Enter a valid email address.";
  if (form.adminLevel === "") problems.adminLevel = "Choose a level.";
  return problems;
}

export const inviteBody = (form: InviteForm): { name: string; email: string; adminLevel: string } => ({ name: form.name.trim(), email: form.email.trim().toLowerCase(), adminLevel: form.adminLevel });

export const USER_ACTION_COPY: Record<UserAction, { button: string; title: string; hint: string; confirm: string; done: string }> = {
  level: { button: "Change level", title: "Change level", hint: "The new level applies on their next request.", confirm: "Change level", done: "Level changed" },
  disable: { button: "Disable", title: "Disable this admin", hint: "They are signed out at once and cannot sign in until you enable them again. The account is kept.", confirm: "Disable", done: "Admin disabled" },
  enable: { button: "Enable", title: "Enable this admin", hint: "They can sign in again with their old password.", confirm: "Enable", done: "Admin enabled" },
};

export const statusText = (user: Pick<AdminUser, "accountStatus" | "accepted">): string =>
  user.accountStatus !== "active" ? "Disabled" : user.accepted ? "Active" : "Invited, not accepted yet";

/** The password rule the invitation and the reset pages check before sending (the server checks again). */
export function newPasswordProblem(password: string, confirm: string): string | null {
  if (password.length < 8) return "The password must be at least 8 characters.";
  if (password.length > 200) return "The password is too long.";
  return password === confirm ? null : "The two passwords are not the same.";
}
