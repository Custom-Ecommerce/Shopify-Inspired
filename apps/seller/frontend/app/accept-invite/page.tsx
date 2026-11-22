"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AccountCard, FormAlert, readApiError } from "@/components/auth/AccountCard";
import { Button } from "@/components/ui/button";
import {
  INVALID_TEXT,
  INVALID_TITLE,
  ROLE_BLURBS,
  decideInviteView,
  inviteLoginHref,
  inviteSignupHref,
  isInviteToken,
  roleName,
  type InviteInfo,
  type InviteRole,
} from "@/lib/invite-view";

/**
 * Sprint 8 (S8-B2, D-118): the link of the staff invite email. It opens with or without a session and says what to do next:
 *   - the invite is not valid (unknown, expired, used or cancelled: the server gives one answer, so the page never says which);
 *   - valid and signed out: sign in, or create the account, with the invited email, and come back here;
 *   - valid and signed in with another account: say so, offer to sign out;
 *   - valid and signed in with the invited email: one button to join;
 *   - accepted.
 * The page decides nothing about access: the server checks the token, its expiry and the email again when the button is pressed.
 */
function AcceptInvite() {
  const token = useSearchParams().get("token");
  const [info, setInfo] = useState<InviteInfo | null | "error">(null);
  const [account, setAccount] = useState<string | "none" | null>(null);
  const [accepted, setAccepted] = useState<{ storeName: string; role: InviteRole } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !isInviteToken(token)) return;
    started.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/team/invite?token=" + encodeURIComponent(token), { cache: "no-store" });
        setInfo(res.ok ? ((await res.json().catch(() => ({ valid: false }))) as InviteInfo) : "error");
      } catch {
        setInfo("error");
      }
      try {
        const res = await fetch("/api/account/me", { cache: "no-store" });
        if (res.status === 401) {
          setAccount("none");
          return;
        }
        const data = (await res.json().catch(() => null)) as { user?: { email?: unknown } } | null;
        setAccount(res.ok && typeof data?.user?.email === "string" ? data.user.email : "none");
      } catch {
        setAccount("none");
      }
    })();
  }, [token]);

  const join = useCallback(async () => {
    if (!isInviteToken(token)) return;
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/team/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as { storeName?: unknown; role?: unknown } | null;
        setAccepted({ storeName: typeof data?.storeName === "string" ? data.storeName : "the store", role: (data?.role as InviteRole) ?? "staff" });
        return;
      }
      const error = await readApiError(res);
      if (error.code === "INVITE_INVALID") setInfo({ valid: false });
      else setProblem(error.message);
    } catch {
      setProblem("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [token]);

  async function signOutThenSignIn() {
    if (!isInviteToken(token)) return;
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", redirect: "manual" });
    } finally {
      window.location.assign(inviteLoginHref(token));
    }
  }

  const view = decideInviteView({ token, info, account, accepted });

  if (view.kind === "loading") {
    return (
      <AccountCard title="Checking your invitation…">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> One moment.
        </p>
      </AccountCard>
    );
  }

  if (view.kind === "invalid") {
    return (
      <AccountCard title={INVALID_TITLE} intro={INVALID_TEXT}>
        <Button render={<Link href="/" />} variant="outline" size="lg" className="w-full">
          Go to your dashboard
        </Button>
      </AccountCard>
    );
  }

  if (view.kind === "error") {
    return (
      <AccountCard title="Something went wrong" intro={view.message}>
        <Button variant="outline" size="lg" className="w-full" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </AccountCard>
    );
  }

  if (view.kind === "accepted") {
    return (
      <AccountCard title={`You joined ${view.storeName}`} intro={`You are now ${roleName(view.role)} of this store. What you can do depends on your role.`}>
        <Button render={<Link href="/" />} variant="clay" size="lg" className="w-full">
          Go to your dashboard
        </Button>
      </AccountCard>
    );
  }

  const heading = `Join ${view.storeName}`;
  const intro = `You were invited as ${roleName(view.role)}. ${ROLE_BLURBS[view.role]}`;

  if (view.kind === "sign_in") {
    return (
      <AccountCard title={heading} intro={intro}>
        <div className="flex flex-col gap-4">
          <FormAlert tone="info">
            This invitation is for <strong className="break-all">{view.email}</strong>. Sign in with that address, or create an account with it. You will come back here to accept.
          </FormAlert>
          <Button render={<Link href={inviteLoginHref(token ?? "")} />} variant="clay" size="lg" className="w-full">
            Sign in
          </Button>
          <Button render={<Link href={inviteSignupHref(token ?? "")} />} variant="outline" size="lg" className="w-full">
            Create an account
          </Button>
        </div>
      </AccountCard>
    );
  }

  if (view.kind === "wrong_account") {
    return (
      <AccountCard title={heading} intro={intro}>
        <div className="flex flex-col gap-4">
          <FormAlert tone="error">
            This invitation is for <strong className="break-all">{view.email}</strong>, but you are signed in as <strong className="break-all">{view.signedInAs}</strong>.
          </FormAlert>
          <Button variant="clay" size="lg" className="w-full" onClick={signOutThenSignIn} disabled={busy} aria-busy={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Sign out and use another account
          </Button>
          <Button render={<Link href="/" />} variant="outline" size="lg" className="w-full">
            Stay signed in
          </Button>
        </div>
      </AccountCard>
    );
  }

  return (
    <AccountCard title={heading} intro={intro}>
      <div className="flex flex-col gap-4">
        <p className="break-all text-sm text-muted-foreground">Signed in as {view.email}.</p>
        {problem ? <FormAlert tone="error">{problem}</FormAlert> : null}
        <Button variant="clay" size="lg" className="w-full" onClick={join} disabled={busy} aria-busy={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          Join {view.storeName}
        </Button>
      </div>
    </AccountCard>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInvite />
    </Suspense>
  );
}
