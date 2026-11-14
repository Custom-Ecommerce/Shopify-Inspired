"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, LogOut } from "lucide-react";
import { FormAlert, readApiError } from "@/components/auth/AccountCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/*
 * Sprint 4 EP-08.US04.T02: the seller's own account. Three forms (profile, password, email) and "Sign out of all other
 * devices". Every form shows its field messages, a success state and an error state. Mobile first: one column.
 */

interface Me {
  name: string;
  email: string;
  phone: string | null;
  pendingEmail: string | null;
  emailVerified: boolean;
}

type Feedback = { tone: "success" | "error"; text: string } | null;

const PASSWORD_MIN = 8;

function Field({
  id,
  label,
  error,
  hint,
  ...input
}: { id: string; label: string; error?: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className="h-11" aria-invalid={error !== undefined} aria-describedby={error ? id + "-error" : hint ? id + "-hint" : undefined} {...input} />
      {error ? (
        <p id={id + "-error"} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={id + "-hint"} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const run = useCallback(async (url: string, method: "POST" | "PATCH", body: unknown, success: string): Promise<unknown | null> => {
    setBusy(true);
    setFeedback(null);
    setFieldErrors({});
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (res.ok) {
        setFeedback({ tone: "success", text: success });
        return (await res.json().catch(() => ({}))) as unknown;
      }
      const problem = await readApiError(res);
      if (problem.field) setFieldErrors({ [problem.field]: problem.message });
      else setFeedback({ tone: "error", text: problem.message });
      return null;
    } catch {
      setFeedback({ tone: "error", text: "Could not reach the server. Please try again." });
      return null;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, feedback, fieldErrors, setFieldErrors, run };
}

function ProfileForm({ me, onSaved }: { me: Me; onSaved: (next: Partial<Me>) => void }) {
  const [name, setName] = useState(me.name);
  const [phone, setPhone] = useState(me.phone ?? "");
  const form = useSubmit();

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (name.trim() === "") {
      form.setFieldErrors({ name: "Enter your name." });
      return;
    }
    const data = (await form.run("/api/account/me", "PATCH", { name: name.trim(), phone: phone.trim() }, "Profile saved.")) as { user?: { name?: string; phone?: string | null } } | null;
    if (data?.user) onSaved({ name: data.user.name ?? name, phone: data.user.phone ?? null });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field id="name" label="Name" value={name} maxLength={120} autoComplete="name" onChange={(e) => setName(e.target.value)} error={form.fieldErrors.name} />
          <Field
            id="phone"
            label="Mobile number"
            type="tel"
            inputMode="tel"
            value={phone}
            placeholder="0300 1234567"
            autoComplete="tel"
            onChange={(e) => setPhone(e.target.value)}
            error={form.fieldErrors.phone}
            hint="Leave it empty to remove it."
          />
          {form.feedback ? <FormAlert tone={form.feedback.tone}>{form.feedback.text}</FormAlert> : null}
          <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={form.busy} aria-busy={form.busy}>
            {form.busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Save profile
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const form = useSubmit();

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (current === "") errors.currentPassword = "Enter your current password.";
    if (next.length < PASSWORD_MIN) errors.newPassword = `Use at least ${PASSWORD_MIN} characters.`;
    if (repeat !== next) errors.repeat = "The two new passwords are not the same.";
    if (Object.keys(errors).length > 0) {
      form.setFieldErrors(errors);
      return;
    }
    const done = await form.run("/api/account/password", "POST", { currentPassword: current, newPassword: next }, "Password changed. Your other devices were signed out.");
    if (done !== null) {
      setCurrent("");
      setNext("");
      setRepeat("");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field id="currentPassword" label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} error={form.fieldErrors.currentPassword} />
          <Field id="newPassword" label="New password" type="password" autoComplete="new-password" maxLength={128} value={next} onChange={(e) => setNext(e.target.value)} error={form.fieldErrors.newPassword} hint="At least 8 characters." />
          <Field id="repeat" label="Repeat the new password" type="password" autoComplete="new-password" maxLength={128} value={repeat} onChange={(e) => setRepeat(e.target.value)} error={form.fieldErrors.repeat} />
          {form.feedback ? <FormAlert tone={form.feedback.tone}>{form.feedback.text}</FormAlert> : null}
          <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={form.busy} aria-busy={form.busy}>
            {form.busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function EmailForm({ me, onRequested }: { me: Me; onRequested: (pending: string) => void }) {
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const form = useSubmit();

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (!/^\S+@\S+\.\S+$/.test(newEmail.trim())) errors.newEmail = "Enter the new email address.";
    if (password === "") errors.password = "Enter your current password.";
    if (Object.keys(errors).length > 0) {
      form.setFieldErrors(errors);
      return;
    }
    const target = newEmail.trim().toLowerCase();
    const done = await form.run("/api/account/email", "POST", { password, newEmail: target }, "Check " + target + ": open the link we sent to confirm it.");
    if (done !== null) {
      setPassword("");
      onRequested(target);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <p className="break-words text-sm text-muted-foreground">
            You sign in with <span className="font-medium text-foreground">{me.email}</span>
            {me.emailVerified ? " (verified)." : " (not verified yet)."}
            {me.pendingEmail ? " Waiting for you to confirm " + me.pendingEmail + "; until then your current email stays your login." : ""}
          </p>
          <Field id="newEmail" label="New email" type="email" autoComplete="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} error={form.fieldErrors.newEmail} />
          <Field id="password" label="Current password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={form.fieldErrors.password ?? form.fieldErrors.currentPassword} />
          {form.feedback ? <FormAlert tone={form.feedback.tone}>{form.feedback.text}</FormAlert> : null}
          <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={form.busy} aria-busy={form.busy}>
            {form.busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Send confirmation link
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function SessionsCard() {
  const form = useSubmit();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Devices</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">Signed in on a phone or computer you no longer use? Sign it out. This device stays signed in.</p>
        {form.feedback ? <FormAlert tone={form.feedback.tone}>{form.feedback.tone === "success" ? "All other devices were signed out." : form.feedback.text}</FormAlert> : null}
        <Button
          variant="outline"
          className="min-h-11 w-full sm:w-auto"
          disabled={form.busy}
          aria-busy={form.busy}
          onClick={() => void form.run("/api/account/sessions/revoke-others", "POST", undefined, "All other devices were signed out.")}
        >
          {form.busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <LogOut className="size-4" aria-hidden="true" />}
          Sign out of all other devices
        </Button>
      </CardContent>
    </Card>
  );
}

export default function AccountPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch("/api/account/me", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { user?: Partial<Me> & { email?: string } };
      const user = data.user ?? {};
      setMe({
        name: user.name ?? "",
        email: user.email ?? "",
        phone: user.phone ?? null,
        pendingEmail: user.pendingEmail ?? null,
        emailVerified: user.emailVerified === true,
      });
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-sm text-muted-foreground">Your name, password, email and signed-in devices.</p>
      </div>
      {loadError ? (
        <FormAlert tone="error">
          Could not load your account.{" "}
          <button type="button" className="font-medium underline" onClick={() => void load()}>
            Try again
          </button>
        </FormAlert>
      ) : me === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading…
        </p>
      ) : (
        <>
          <ProfileForm me={me} onSaved={(next) => setMe({ ...me, ...next })} />
          <PasswordForm />
          <EmailForm me={me} onRequested={(pending) => setMe({ ...me, pendingEmail: pending })} />
          <SessionsCard />
        </>
      )}
    </div>
  );
}
