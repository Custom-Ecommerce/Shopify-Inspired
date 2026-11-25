import type { TeamMember } from "@markaz/contracts/team";
import { planLimitFrom } from "./plan-usage";

/**
 * Sprint 8 (S8-B4, D-118): the Team page. Pure: the words, which actions a member row offers, the seat line, the form checks and how a refusal reads. No React, no
 * fetch. The server decides everything (owner only, the seats, one invite per email); this only presents it.
 */

export type MemberRole = "manager" | "staff" | "support";

export const MEMBER_ROLES: ReadonlyArray<{ value: MemberRole; name: string; help: string }> = [
  { value: "manager", name: "Manager", help: "Runs the store day to day. Not payments, payouts, billing, domain, API keys or the team." },
  { value: "staff", name: "Staff", help: "Orders, products and stock." },
  { value: "support", name: "Support", help: "Orders (view and notes), returns, customers, review replies and messages." },
];

export const roleName = (role: string): string => MEMBER_ROLES.find((item) => item.value === role)?.name ?? "Team member";

export type MemberStatus = "invited" | "active" | "disabled";

export function statusText(member: Pick<TeamMember, "status" | "inviteExpired">): string {
  if (member.status === "invited") return member.inviteExpired ? "Invitation expired" : "Invited";
  return member.status === "active" ? "Active" : "Disabled";
}

export const memberTitle = (member: Pick<TeamMember, "name" | "email">): string => (member.name && member.name.trim() !== "" ? member.name : member.email);

export const MEMBER_ACTIONS = ["resend", "disable", "enable", "remove"] as const;
export type MemberAction = (typeof MEMBER_ACTIONS)[number];

export const isMemberAction = (value: unknown): value is MemberAction => typeof value === "string" && (MEMBER_ACTIONS as readonly string[]).includes(value);

/** What a row offers: an invitation is resent or removed; an active member is disabled or removed; a disabled one enabled or removed. */
export function actionsFor(status: MemberStatus): MemberAction[] {
  if (status === "invited") return ["resend", "remove"];
  return status === "active" ? ["disable", "remove"] : ["enable", "remove"];
}

export const ACTION_LABELS: Record<MemberAction, string> = { resend: "Send again", disable: "Disable", enable: "Enable", remove: "Remove" };

export const ACTION_DONE: Record<MemberAction, string> = {
  resend: "A new invitation link is on its way. The old link no longer works.",
  disable: "Access switched off. Their next request is refused.",
  enable: "Access is back on.",
  remove: "Removed from your team.",
};

export function removeConfirmText(member: Pick<TeamMember, "name" | "email" | "status">): string {
  return member.status === "invited"
    ? `The invitation for ${member.email} is cancelled and its link stops working.`
    : `${memberTitle(member)} loses access to this store at once. You can invite them again later.`;
}

export interface SeatInfo {
  used: number;
  limit: number | null;
}

/** "2 of 3 seats"; with no limit "2 seats in use". */
export function seatText(seats: SeatInfo): string {
  if (seats.limit === null) return `${seats.used} ${seats.used === 1 ? "seat" : "seats"} in use (no limit)`;
  return `${seats.used} of ${seats.limit} ${seats.limit === 1 ? "seat" : "seats"}`;
}

/** Whether a new invitation can be offered. The server checks again (403 PLAN_LIMIT_REACHED). */
export const hasFreeSeat = (seats: SeatInfo): boolean => seats.limit === null || seats.used < seats.limit;

export function inviteProblems(form: { email: string; role: string }): Record<string, string> {
  const out: Record<string, string> = {};
  const email = form.email.trim();
  if (email === "") out.email = "Enter their email address.";
  else if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(email)) out.email = "Enter a valid email address.";
  if (!MEMBER_ROLES.some((item) => item.value === form.role)) out.role = "Choose manager, staff or support.";
  return out;
}

export interface Refusal {
  /** Shown above the form or the list. */
  message: string;
  /** The field the server named, or null. */
  field: string | null;
  /** Set for 403 PLAN_LIMIT_REACHED: the server's upgrade hint, shown with a link to billing. */
  upgradeHint: string | null;
}

/** Reads a refused answer of the BFF ({ error, code, field, details }). */
export function refusalFrom(body: unknown, fallback = "That did not work. Please try again."): Refusal {
  const record = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const limit = planLimitFrom(body);
  const message = typeof record.error === "string" ? record.error : fallback;
  const field = typeof record.field === "string" && record.field !== "" ? record.field : null;
  return { message, field, upgradeHint: limit === null ? null : limit.upgradeHint };
}
