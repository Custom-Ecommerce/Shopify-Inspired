"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { useDashboard, useStoreHref } from "@/lib/dashboard-context";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  canConnect,
  canSetRedirect,
  canVerify,
  checkedText,
  dnsSteps,
  domainFailure,
  nextStepText,
  readDomainState,
  redirectSettingBody,
  redirectText,
  STATUS_LABELS,
  type DomainState,
} from "@/lib/domain-view";

const TONE: Record<DomainState["status"], string> = {
  unset: "bg-muted text-muted-foreground",
  pending: "bg-warning/10 text-warning",
  verified: "bg-success/10 text-success",
  failed: "bg-destructive/10 text-destructive",
};

export default function DashboardDomainPage() {
  const storeFetch = useStoreFetch();
  const { store, storeId } = useDashboard();
  const href = useStoreHref();
  const [state, setState] = useState<DomainState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState<"connect" | "verify" | "disconnect" | "redirect" | null>(null);
  const [error, setError] = useState<{ message: string; upgrade: boolean } | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  const call = useCallback(
    async (path: string, init: RequestInit): Promise<DomainState | null> => {
      try {
        const res = await storeFetch(path, init);
        const data: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const failure = domainFailure(res.status, data);
          setError({ message: failure.message, upgrade: failure.upgrade });
          return null;
        }
        const next = readDomainState(data);
        if (next === null) setError({ message: "We could not read the answer. Please try again.", upgrade: false });
        return next;
      } catch {
        setError({ message: "Could not reach the server. Please try again.", upgrade: false });
        return null;
      }
    },
    [storeFetch],
  );

  useEffect(() => {
    let live = true;
    void (async () => {
      const next = await call("/api/proxy/domain", { method: "GET", cache: "no-store" });
      if (!live) return;
      setState(next);
      setLoaded(true);
    })();
    return () => {
      live = false;
    };
  }, [call]);

  if (!store) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="font-heading text-2xl font-semibold mb-2">Domain</h1>
        <p className="text-sm text-muted-foreground">Store details could not be loaded. Try refreshing the page.</p>
      </div>
    );
  }

  async function connect() {
    if (!domain.trim()) return;
    setBusy("connect");
    setError(null);
    const next = await call("/api/proxy/domain/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: domain.trim() }),
    });
    if (next) {
      setState(next);
      setDomain("");
    }
    setBusy(null);
  }

  async function verify() {
    setBusy("verify");
    setError(null);
    const next = await call("/api/proxy/domain/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (next) setState(next);
    setBusy(null);
  }

  async function disconnect() {
    setBusy("disconnect");
    setError(null);
    const next = await call("/api/proxy/domain/disconnect", { method: "POST" });
    if (next) {
      setState(next);
      setConfirmOff(false);
    }
    setBusy(null);
  }

  async function setRedirect(on: boolean) {
    setBusy("redirect");
    setError(null);
    const res = await storeFetch(`/api/proxy/stores/${encodeURIComponent(storeId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(redirectSettingBody(on)),
    }).catch(() => null);
    if (res && res.ok) setState((current) => (current ? { ...current, redirectToCustomDomain: on } : current));
    else setError({ message: "We could not save this. Please try again.", upgrade: false });
    setBusy(null);
  }

  const hasDomain = state?.domain != null;
  const checked = state ? checkedText(state.checkedAt) : null;
  const steps = state ? dnsSteps(state) : [];

  return (
    <main className="p-4 sm:p-8 max-w-lg flex flex-col gap-6">
      <PageHeader title="Your own domain" className="mb-0" description={`Show ${store.name} on your own web address, like shop.yourbrand.pk.`} />

      {!loaded && <p className="text-sm text-muted-foreground">Loading…</p>}

      {loaded && state === null && !error && <p className="text-sm text-destructive">We could not load your domain. Please refresh the page.</p>}

      {state && !state.planAllowsCustomDomain && (
        <SectionCard>
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">A custom domain is part of the Growth plan.</p>
            <p className="text-sm text-muted-foreground">Upgrade your plan to use your own domain. Your store keeps working on its Markazify address.</p>
            <Link href={href("/billing")} className="text-sm underline">
              See plans
            </Link>
          </div>
        </SectionCard>
      )}

      {state && hasDomain && (
        <SectionCard>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-sm font-mono break-all">{state.domain}</span>
              <span className={`text-xs font-medium rounded-full px-2.5 py-1 ${TONE[state.status]}`}>{STATUS_LABELS[state.status]}</span>
            </div>
            <p className="text-sm text-muted-foreground">{nextStepText(state)}</p>
            {state.failureMessage && state.status !== "unset" && <p className="text-sm text-destructive">{state.failureMessage}</p>}
            {state.vercelConfigured === false && state.status !== "verified" && (
              <p className="text-xs rounded-xl px-3 py-2 bg-warning/10 text-warning">
                Automatic domain setup is not switched on for this platform yet, so a check may pass here before the domain is live.
              </p>
            )}
            {checked && <p className="text-xs text-muted-foreground">{checked}</p>}

            {steps.length > 0 && state.status !== "verified" && (
              <ol className="list-decimal pl-5 text-sm text-muted-foreground flex flex-col gap-1">
                {steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            )}

            {state.dnsRecords.length > 0 && (
              <div className="flex flex-col gap-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Records to add</p>
                {state.dnsRecords.map((r) => (
                  <div key={r.type + r.name} className="rounded-xl border p-3 flex flex-col gap-2 text-sm">
                    <div className="flex gap-2">
                      <span className="w-14 shrink-0 text-xs text-muted-foreground">Type</span>
                      <span className="font-mono">{r.type}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-14 shrink-0 text-xs text-muted-foreground">Name</span>
                      <span className="font-mono break-all">{r.name}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-14 shrink-0 text-xs text-muted-foreground">Value</span>
                      <span className="font-mono break-all">{r.value}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {canSetRedirect(state) && state.domain && (
              <label className="flex items-start gap-3 rounded-xl border p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={state.redirectToCustomDomain}
                  disabled={busy !== null}
                  onChange={(e) => void setRedirect(e.target.checked)}
                />
                <span>
                  <span className="block font-medium">Send visitors to my own domain</span>
                  <span className="block text-muted-foreground">{redirectText(state.redirectToCustomDomain, state.domain)}</span>
                </span>
              </label>
            )}

            <div className="flex flex-col sm:flex-row gap-3 pt-1">
              {canVerify(state) && (
                <Button variant="clay" onClick={verify} disabled={busy !== null} className="flex-1">
                  {busy === "verify" ? "Checking…" : "Check now"}
                </Button>
              )}
              {!confirmOff ? (
                <Button variant="clay-soft" onClick={() => setConfirmOff(true)} disabled={busy !== null}>
                  Disconnect
                </Button>
              ) : (
                <Button variant="clay-soft" onClick={disconnect} disabled={busy !== null}>
                  {busy === "disconnect" ? "Disconnecting…" : "Yes, disconnect"}
                </Button>
              )}
            </div>
            {confirmOff && <p className="text-xs text-muted-foreground">Your store will go back to its Markazify address only.</p>}
          </div>
        </SectionCard>
      )}

      {state && canConnect(state) && (
        <SectionCard>
          <div className="flex flex-col gap-4">
            <div>
              <Label className="block text-xs font-medium text-muted-foreground mb-1">{hasDomain ? "Use a different domain" : "Your domain (no https://)"}</Label>
              <Input
                type="text"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="shop.yourbrand.pk"
                className="font-mono"
              />
            </div>
            <Button variant="clay" onClick={connect} disabled={busy !== null || !domain.trim()}>
              {busy === "connect" ? "Saving…" : hasDomain ? "Change domain" : "Connect domain"}
            </Button>
          </div>
        </SectionCard>
      )}

      {error && (
        <SectionCard>
          <p className="text-sm text-destructive">{error.message}</p>
          {error.upgrade && (
            <Link href={href("/billing")} className="text-sm underline">
              See plans
            </Link>
          )}
        </SectionCard>
      )}
    </main>
  );
}
