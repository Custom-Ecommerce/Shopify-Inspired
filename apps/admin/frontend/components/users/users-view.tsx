"use client";

import { useCallback, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { AdminUser } from "@markaz/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { inviteAdminUser, listAdminUsers, runUserAction } from "@/lib/api/client";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";
import { useAdminMutation } from "@/lib/hooks/use-admin-mutation";
import { ADMIN_LEVEL_OPTIONS, REASON_MAX, USER_ACTION_COPY, inviteBody, inviteProblems, levelLabel, levelTone, reasonProblem, statusText, userActions, type AdminLevelValue, type InviteForm, type InviteProblems, type UserAction } from "@/lib/admin-users";

/**
 * The Admin users page at /users (Sprint 6 S6-B6, D-118). Owner level only: the server refuses everyone else, and the console hides the page from them.
 * Invite by email, change a level, disable and enable. You never see actions on yourself or on the last active owner. One column of cards at 375 px.
 */
export function UsersView({ selfId = "" }: { selfId?: string }) {
  const { data, error, loading, refetch } = useAdminFetch((signal) => listAdminUsers(signal), []);
  const [intent, setIntent] = useState<{ action: UserAction; user: AdminUser } | null>(null);
  const [inviting, setInviting] = useState(false);
  const users = data?.users ?? [];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading mb-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Admin users</h2>
          <p className="text-sm text-muted-foreground">Who can use this console, and what each level may do. Accounts are disabled, never deleted.</p>
        </div>
        <Button className="min-h-11 w-full sm:w-auto" onClick={() => setInviting(true)}>
          Invite an admin
        </Button>
      </div>

      {error !== null && users.length === 0 ? (
        <Card role="alert" className="flex flex-col items-center gap-3 border-destructive/20 bg-destructive/8 px-6 py-10 text-center">
          <p className="max-w-sm text-sm font-medium">{error.message}</p>
          <Button variant="outline" size="sm" onClick={refetch}>
            Try again
          </Button>
        </Card>
      ) : loading && !data ? (
        <div className="flex flex-col gap-3" aria-busy>
          {[0, 1, 2].map((k) => (
            <Skeleton key={k} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Admin users" data-slot="user-list">
          {users.map((user) => (
            <li key={user.id} className="rounded-xl border border-border bg-card p-4" data-level={user.adminLevel}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold">{user.name}</p>
                  <p className="break-all text-xs text-muted-foreground">{user.email}</p>
                </div>
                <Badge variant={levelTone(user.adminLevel)}>{levelLabel(user.adminLevel)}</Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{statusText(user)}</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                {userActions(user, selfId, users).map((action) => (
                  <Button key={action} variant={action === "disable" ? "destructive" : "outline"} className="min-h-11" onClick={() => setIntent({ action, user })}>
                    {USER_ACTION_COPY[action].button}
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      {inviting ? <InviteDialog onClose={() => setInviting(false)} onDone={() => { setInviting(false); refetch(); }} /> : null}
      {intent !== null ? <ActionDialog key={intent.action + intent.user.id} {...intent} onClose={() => setIntent(null)} onDone={() => { setIntent(null); refetch(); }} /> : null}
    </div>
  );
}

function InviteDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState<InviteForm>({ name: "", email: "", adminLevel: "" });
  const [problems, setProblems] = useState<InviteProblems>({});
  const submit = useCallback((body: ReturnType<typeof inviteBody>) => inviteAdminUser(body), []);
  const mutation = useAdminMutation(submit);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const found = inviteProblems(form);
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    if ((await mutation.run(inviteBody(form))) === null) return;
    toast.success("Invitation sent");
    onDone();
  }

  return (
    <Dialog open onClose={onClose} title="Invite an admin" description="They get an email with a link that works once for 7 days." busy={mutation.pending}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-name">Name</Label>
          <Input id="invite-name" className="min-h-11" value={form.name} maxLength={80} aria-invalid={problems.name !== undefined} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          {problems.name ? <p role="alert" className="text-sm text-destructive">{problems.name}</p> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input id="invite-email" type="email" className="min-h-11" value={form.email} aria-invalid={problems.email !== undefined} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          {problems.email ? <p role="alert" className="text-sm text-destructive">{problems.email}</p> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-level">Level</Label>
          <Select id="invite-level" value={form.adminLevel} onChange={(e) => setForm((f) => ({ ...f, adminLevel: e.target.value as AdminLevelValue | "" }))}>
            <option value="">Choose a level</option>
            {ADMIN_LEVEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          {form.adminLevel !== "" ? <p className="text-xs text-muted-foreground">{ADMIN_LEVEL_OPTIONS.find((o) => o.value === form.adminLevel)?.hint}</p> : null}
          {problems.adminLevel ? <p role="alert" className="text-sm text-destructive">{problems.adminLevel}</p> : null}
        </div>
        {mutation.error ? <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p> : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" className="min-h-11" disabled={mutation.pending}>
            {mutation.pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Send invitation
          </Button>
          <Button variant="ghost" className="min-h-11" onClick={onClose} disabled={mutation.pending}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ActionDialog({ action, user, onClose, onDone }: { action: UserAction; user: AdminUser; onClose: () => void; onDone: () => void }) {
  const copy = USER_ACTION_COPY[action];
  const [reason, setReason] = useState("");
  const [level, setLevel] = useState<string>(user.adminLevel);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = useCallback((body: { reason: string; adminLevel?: string }) => runUserAction(action, user.id, body), [action, user.id]);
  const mutation = useAdminMutation(submit);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const found = reasonProblem(reason);
    setProblem(found);
    if (found !== null) return;
    if ((await mutation.run(action === "level" ? { adminLevel: level, reason: reason.trim() } : { reason: reason.trim() })) === null) return;
    toast.success(copy.done);
    onDone();
  }

  return (
    <Dialog open onClose={onClose} title={copy.title} description={user.name + " · " + user.email} busy={mutation.pending}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <p className="text-sm text-muted-foreground">{copy.hint}</p>
        {action === "level" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="level-select">New level</Label>
            <Select id="level-select" value={level} onChange={(e) => setLevel(e.target.value)}>
              {ADMIN_LEVEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="user-reason">Reason (required)</Label>
          <Textarea id="user-reason" rows={3} maxLength={REASON_MAX} value={reason} aria-invalid={problem !== null} onChange={(e) => setReason(e.target.value)} />
          {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
        </div>
        {mutation.error ? <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p> : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" className="min-h-11" variant={action === "disable" ? "destructive" : "default"} disabled={mutation.pending}>
            {mutation.pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {copy.confirm}
          </Button>
          <Button variant="ghost" className="min-h-11" onClick={onClose} disabled={mutation.pending}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
