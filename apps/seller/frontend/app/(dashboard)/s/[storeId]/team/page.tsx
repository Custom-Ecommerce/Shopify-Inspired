"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, UserPlus } from "lucide-react";
import type { TeamListResponse, TeamMember } from "@markaz/contracts/team";
import { FormAlert } from "@/components/auth/AccountCard";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useActiveStoreId, useDashboard } from "@/lib/dashboard-context";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { announcePlanLimit } from "@/lib/plan-usage";
import { canUse } from "@/lib/role-access";
import { storeHref } from "@/lib/store-routes";
import {
  ACTION_DONE,
  ACTION_LABELS,
  MEMBER_ROLES,
  actionsFor,
  hasFreeSeat,
  inviteProblems,
  memberTitle,
  refusalFrom,
  removeConfirmText,
  seatText,
  statusText,
  type MemberAction,
  type MemberRole,
  type Refusal,
} from "@/lib/team-view";

type Notice = { tone: "error" | "success"; text: string; upgradeHint?: string | null } | null;

/**
 * Sprint 8 (S8-B4, D-118): the store's team. Owner only (the menu hides it from everyone else, and every call is refused by the backend). Members with their
 * role and status, invite, change role, disable, enable, send an invitation again, remove (with a confirm), and the plan's seat usage. 375 px first: one
 * column, rows stack, full-width buttons.
 */
export default function TeamPage() {
  const storeId = useActiveStoreId();
  const { activeStore } = useDashboard();
  const owner = canUse(activeStore.role, "team");
  const storeFetch = useStoreFetch();
  const base = `/api/proxy/stores/${encodeURIComponent(storeId)}/team`;
  const [data, setData] = useState<TeamListResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("staff");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dialogRefusal, setDialogRefusal] = useState<Refusal | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await storeFetch(base, { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as (TeamListResponse & { error?: string }) | null;
      if (!res.ok || !body?.members) {
        setLoadError(body?.error ?? "The team could not be loaded.");
        return;
      }
      setData(body);
    } catch {
      setLoadError("Could not reach the server. Please try again.");
    }
  }, [storeFetch, base]);

  useEffect(() => {
    if (owner) void load();
  }, [owner, load]);

  /** One write, then the list again (so the revision of every row is current). */
  async function write(url: string, method: "POST" | "PATCH", body: unknown): Promise<{ ok: boolean; refusal: Refusal | null }> {
    try {
      const res = await storeFetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) return { ok: true, refusal: null };
      const answer = (await res.json().catch(() => null)) as unknown;
      announcePlanLimit(answer);
      return { ok: false, refusal: refusalFrom(answer) };
    } catch {
      return { ok: false, refusal: { message: "Could not reach the server. Please try again.", field: null, upgradeHint: null } };
    }
  }

  async function act(member: TeamMember, action: MemberAction) {
    setBusyId(member.id);
    setNotice(null);
    const result = await write(`${base}/${encodeURIComponent(member.id)}/${action}`, "POST", { revision: member.revision });
    setNotice(result.ok ? { tone: "success", text: ACTION_DONE[action] } : { tone: "error", text: result.refusal!.message, upgradeHint: result.refusal!.upgradeHint });
    await load();
    setBusyId(null);
  }

  async function changeRole(member: TeamMember, next: MemberRole) {
    if (next === member.role) return;
    setBusyId(member.id);
    setNotice(null);
    const result = await write(`${base}/${encodeURIComponent(member.id)}`, "PATCH", { role: next, revision: member.revision });
    setNotice(result.ok ? { tone: "success", text: "Role changed. It applies from their next request." } : { tone: "error", text: result.refusal!.message });
    await load();
    setBusyId(null);
  }

  async function sendInvite(event: React.FormEvent) {
    event.preventDefault();
    const problems = inviteProblems({ email, role });
    setErrors(problems);
    setDialogRefusal(null);
    if (Object.keys(problems).length > 0) return;
    setSending(true);
    const result = await write(`${base}/invite`, "POST", { email: email.trim(), role });
    setSending(false);
    if (result.ok) {
      setInviting(false);
      setEmail("");
      setNotice({ tone: "success", text: "Invitation sent. The link works for 7 days." });
      await load();
      return;
    }
    const refusal = result.refusal!;
    if (refusal.field === "email" || refusal.field === "role") setErrors({ [refusal.field]: refusal.message });
    else setDialogRefusal(refusal);
  }

  const billingHref = storeHref(storeId, "/billing");

  if (!owner) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 sm:p-6">
        <PageHeader title="Team" className="mb-0" />
        <p className="text-sm text-muted-foreground">Only the store owner can manage the team.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-5 p-4 sm:p-6">
      <PageHeader title="Team" description="People who can work in this store with you. Each has their own sign-in." className="mb-0" />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-medium">{data ? seatText(data.seats) : " "}</p>
        <Button
          className="min-h-11 w-full sm:w-auto"
          onClick={() => {
            setErrors({});
            setDialogRefusal(null);
            setInviting(true);
          }}
          disabled={data === null}
        >
          <UserPlus className="size-4" aria-hidden="true" />
          Invite someone
        </Button>
      </div>
      {data && !hasFreeSeat(data.seats) ? (
        <FormAlert tone="info">
          All seats of your plan are in use.{" "}
          <Link href={billingHref} className="font-medium underline">
            See plans
          </Link>
        </FormAlert>
      ) : null}

      {notice ? (
        <FormAlert tone={notice.tone}>
          {notice.text}
          {notice.upgradeHint ? (
            <>
              {" "}
              <Link href={billingHref} className="font-medium underline">
                See plans
              </Link>
            </>
          ) : null}
        </FormAlert>
      ) : null}

      <SectionCard title="Members">
        {loadError ? (
          <FormAlert tone="error">
            {loadError}{" "}
            <button type="button" className="font-medium underline" onClick={() => void load()}>
              Try again
            </button>
          </FormAlert>
        ) : data === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading…
          </p>
        ) : data.members.length === 0 ? (
          <p className="text-sm text-muted-foreground">You are the only one working in this store.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {data.members.map((member) => (
              <li key={member.id} className="flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words font-medium">{memberTitle(member)}</p>
                  {member.name ? <p className="break-all text-sm text-muted-foreground">{member.email}</p> : null}
                  <p className="text-sm text-muted-foreground">{statusText(member)}</p>
                </div>
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                  <select
                    aria-label={"Role of " + memberTitle(member)}
                    className="h-11 w-full rounded-lg border bg-background px-3 text-sm sm:w-auto"
                    value={member.role}
                    disabled={busyId === member.id}
                    onChange={(event) => void changeRole(member, event.target.value as MemberRole)}
                  >
                    {MEMBER_ROLES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  {actionsFor(member.status).map((action) => (
                    <Button
                      key={action}
                      variant={action === "remove" ? "ghost" : "outline"}
                      className="min-h-11 w-full sm:w-auto"
                      disabled={busyId === member.id}
                      onClick={() => (action === "remove" ? setRemoving(member) : void act(member, action))}
                    >
                      {ACTION_LABELS[action]}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <Dialog open={inviting} onOpenChange={(open) => setInviting(open)}>
        <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite someone</DialogTitle>
            <DialogDescription>They get an email with a link. They sign in, or create an account, with that address.</DialogDescription>
          </DialogHeader>
          <form onSubmit={sendInvite} className="flex flex-col gap-4" noValidate>
            <div className="grid gap-1.5">
              <Label htmlFor="invite-email">Email address</Label>
              <Input id="invite-email" className="h-11" type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} aria-invalid={errors.email !== undefined} maxLength={254} />
              {errors.email ? <p className="text-sm text-destructive">{errors.email}</p> : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <select id="invite-role" className="h-11 rounded-lg border bg-background px-3 text-sm" value={role} onChange={(event) => setRole(event.target.value as MemberRole)}>
                {MEMBER_ROLES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.name}
                  </option>
                ))}
              </select>
              {errors.role ? <p className="text-sm text-destructive">{errors.role}</p> : <p className="text-xs text-muted-foreground">{MEMBER_ROLES.find((item) => item.value === role)?.help}</p>}
            </div>
            {dialogRefusal ? (
              <FormAlert tone="error">
                {dialogRefusal.message}
                {dialogRefusal.upgradeHint ? (
                  <>
                    {" "}
                    <Link href={billingHref} className="font-medium underline">
                      See plans
                    </Link>
                  </>
                ) : null}
              </FormAlert>
            ) : null}
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setInviting(false)}>
                Cancel
              </Button>
              <Button type="submit" className="min-h-11" disabled={sending} aria-busy={sending}>
                {sending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                Send invitation
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removing !== null} onOpenChange={(open) => (open ? undefined : setRemoving(null))}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from your team?</AlertDialogTitle>
            <AlertDialogDescription>{removing ? removeConfirmText(removing) : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Keep</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              onClick={() => {
                const target = removing;
                setRemoving(null);
                if (target) void act(target, "remove");
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
