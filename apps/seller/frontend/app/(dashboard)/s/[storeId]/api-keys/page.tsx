"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Copy, Loader2 } from "lucide-react";
import type { ApiKeyCreateResponse, ApiKeyListResponse, ApiKeyScope, ApiKeyView } from "@markaz/contracts/api-keys";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  API_DOCS_HREF,
  API_KEY_NAME_MAX,
  API_KEY_SCOPES,
  SCOPE_COPY,
  SECRET_ONCE_NOTE,
  createProblems,
  createdText,
  isLive,
  keyStatusText,
  keyUsageText,
  lastUsedText,
  revokeConfirmText,
  scopesText,
  toggleScope,
} from "@/lib/api-keys-view";
import { useActiveStoreId, useDashboard } from "@/lib/dashboard-context";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { announcePlanLimit } from "@/lib/plan-usage";
import { canUse } from "@/lib/role-access";
import { storeHref } from "@/lib/store-routes";
import { refusalFrom, type Refusal } from "@/lib/team-view";

/**
 * Sprint 8 (S8-B4, D-118): the store's API keys for the read-only v1 API. Owner only. Create (name and permissions), see the secret ONCE with a copy button, list,
 * revoke with a confirm, and the plan limit. The secret lives only in this page's state while it is shown: it is never written to storage, a URL or a log.
 */
export default function ApiKeysPage() {
  const storeId = useActiveStoreId();
  const { activeStore } = useDashboard();
  const owner = canUse(activeStore.role, "apiKeys");
  const storeFetch = useStoreFetch();
  const base = `/api/proxy/stores/${encodeURIComponent(storeId)}/api-keys`;
  const billingHref = storeHref(storeId, "/billing");
  const [data, setData] = useState<ApiKeyListResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiKeyScope[]>(["products:read"]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyView | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await storeFetch(base, { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as (ApiKeyListResponse & { error?: string }) | null;
      if (!res.ok || !body?.keys) {
        setLoadError(body?.error ?? "The keys could not be loaded.");
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

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const problems = createProblems({ name, scopes });
    setErrors(problems);
    setRefusal(null);
    setNotice(null);
    if (Object.keys(problems).length > 0) return;
    setBusy(true);
    try {
      const res = await storeFetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), scopes }) });
      const body = (await res.json().catch(() => null)) as (ApiKeyCreateResponse & Record<string, unknown>) | null;
      if (!res.ok || typeof body?.secret !== "string") {
        announcePlanLimit(body);
        const refused = refusalFrom(body, "The key could not be created.");
        if (refused.field === "name" || refused.field === "scopes") setErrors({ [refused.field]: refused.message });
        else setRefusal(refused);
        return;
      }
      setSecret(body.secret);
      setCopied(null);
      setName("");
      await load();
    } catch {
      setRefusal({ message: "Could not reach the server. Please try again.", field: null, upgradeHint: null });
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (secret === null) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  }

  async function revoke(key: ApiKeyView) {
    setNotice(null);
    try {
      const res = await storeFetch(`${base}/${encodeURIComponent(key.id)}/revoke`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as unknown;
        setNotice({ tone: "error", text: refusalFrom(body, "The key could not be revoked.").message });
      } else {
        setNotice({ tone: "success", text: "Revoked. It stopped working at once." });
      }
      await load();
    } catch {
      setNotice({ tone: "error", text: "Could not reach the server. Please try again." });
    }
  }

  if (!owner) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 sm:p-6">
        <PageHeader title="API keys" className="mb-0" />
        <p className="text-sm text-muted-foreground">Only the store owner can manage API keys.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-5 p-4 sm:p-6">
      <PageHeader title="API keys" description="Keys let your own tools read this store's products and orders. They cannot change anything." className="mb-0" />
      <p className="text-sm">
        <a href={API_DOCS_HREF} target="_blank" rel="noopener noreferrer" className="font-medium underline">
          Read the API documentation
        </a>
      </p>

      {secret !== null ? (
        <SectionCard title="Your new key">
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">{SECRET_ONCE_NOTE}</p>
            <code className="block break-all rounded-lg border bg-muted/50 p-3 text-xs" data-testid="new-api-key">
              {secret}
            </code>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button type="button" className="min-h-11 w-full sm:w-auto" onClick={() => void copy()}>
                <Copy className="size-4" aria-hidden="true" />
                {copied === "yes" ? "Copied" : "Copy"}
              </Button>
              <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => setSecret(null)}>
                I have saved it
              </Button>
            </div>
            {copied === "failed" ? <p className="text-sm text-destructive">Copying did not work. Select the key above and copy it by hand.</p> : null}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="Create a key">
        <form onSubmit={create} className="flex flex-col gap-4" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="key-name">Name</Label>
            <Input id="key-name" className="h-11" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" maxLength={API_KEY_NAME_MAX + 10} aria-invalid={errors.name !== undefined} />
            {errors.name ? <p className="text-sm text-destructive">{errors.name}</p> : null}
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Permissions</legend>
            {API_KEY_SCOPES.map((scope) => (
              <label key={scope} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
                <input type="checkbox" className="mt-0.5 size-4" checked={scopes.includes(scope)} onChange={(event) => setScopes(toggleScope(scopes, scope, event.target.checked))} />
                <span className="min-w-0">
                  <span className="font-medium">{SCOPE_COPY[scope].name}</span>
                  <span className="block text-muted-foreground">{SCOPE_COPY[scope].help}</span>
                </span>
              </label>
            ))}
            {errors.scopes ? <p className="text-sm text-destructive">{errors.scopes}</p> : null}
          </fieldset>
          {refusal ? (
            <FormAlert tone="error">
              {refusal.message}
              {refusal.upgradeHint ? (
                <>
                  {" "}
                  <Link href={billingHref} className="font-medium underline">
                    See plans
                  </Link>
                </>
              ) : null}
            </FormAlert>
          ) : null}
          <Button type="submit" className="min-h-11 w-full sm:w-auto sm:self-start" disabled={busy} aria-busy={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Create key
          </Button>
        </form>
      </SectionCard>

      {notice ? <FormAlert tone={notice.tone}>{notice.text}</FormAlert> : null}

      <SectionCard title="Your keys" description={data ? keyUsageText(data.usage) : undefined}>
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
        ) : data.keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No keys yet.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {data.keys.map((key) => (
              <li key={key.id} className="flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words font-medium">{key.name}</p>
                  <p className="break-all font-mono text-xs text-muted-foreground">{key.prefix}…</p>
                  <p className="text-sm text-muted-foreground">
                    {scopesText(key.scopes)}. {createdText(key)}. {lastUsedText(key)}. {keyStatusText(key)}.
                  </p>
                </div>
                {isLive(key) ? (
                  <Button variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => setRevoking(key)}>
                    Revoke
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <AlertDialog open={revoking !== null} onOpenChange={(open) => (open ? undefined : setRevoking(null))}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this key?</AlertDialogTitle>
            <AlertDialogDescription>{revoking ? revokeConfirmText(revoking) : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Keep</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              onClick={() => {
                const target = revoking;
                setRevoking(null);
                if (target) void revoke(target);
              }}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
