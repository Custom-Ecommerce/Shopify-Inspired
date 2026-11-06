"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Store as StoreIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { storeBasePath } from "@/lib/store-routes";

interface ApiErrorPayload {
  error?: string;
  code?: string;
  used?: number;
  max?: number;
}

interface CreateStoreSuccess {
  store?: { id?: string | number };
  synced?: boolean;
}

interface FormError {
  message: string;
  /** Show a "try again" hint — the failure is expected to clear on its own. */
  retryable: boolean;
}

function messageFor(status: number, body: ApiErrorPayload | null): FormError {
  switch (body?.code) {
    case "STORE_LIMIT_REACHED":
      return {
        message:
          typeof body.max === "number"
            ? `You've reached your limit of ${body.max} store${body.max === 1 ? "" : "s"}. Contact support if you need more.`
            : "You've reached the maximum number of stores for your account. Contact support if you need more.",
        retryable: false,
      };
    case "ACCOUNT_SUSPENDED":
      return {
        message: "Your seller account is suspended, so new stores can't be created. Please contact support.",
        retryable: false,
      };
    case "SELLER_NOT_SYNCED":
      return {
        message: "We're still finishing setting up your account. Please wait a few seconds and try again.",
        retryable: true,
      };
    case "UNAUTHENTICATED":
      return { message: "Your session has expired. Please sign in again.", retryable: false };
    case "BACKEND_OFFLINE":
    case "ADMIN_UNAVAILABLE":
      return { message: "The platform is temporarily unavailable. Please try again in a moment.", retryable: true };
    default:
      return {
        message: body?.error || `Could not create your store (error ${status}). Please try again.`,
        retryable: status >= 500,
      };
  }
}

export function CreateStoreForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<FormError | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") {
      setError({ message: "Please enter a store name.", retryable: false });
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/workspace/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = (await res.json().catch(() => null)) as (ApiErrorPayload & CreateStoreSuccess) | null;

      if (res.status === 401) {
        router.push("/login?clear=1");
        return;
      }

      if (res.status !== 201) {
        setError(messageFor(res.status, data));
        return;
      }

      const newStoreId = data?.store?.id;
      if (newStoreId === undefined || newStoreId === null || String(newStoreId) === "") {
        setError({ message: "Store created, but we couldn't open it. Check your stores list.", retryable: false });
        router.push("/stores");
        router.refresh();
        return;
      }

      // If replication to this dashboard hasn't landed yet, `/s/<id>` would reject the store as
      // not owned — send the seller to the list, where it appears as soon as sync completes.
      router.push(data?.synced === false ? "/stores" : storeBasePath(String(newStoreId)));
      router.refresh();
    } catch {
      setError({ message: "Could not reach the server. Please try again.", retryable: true });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      <div className="grid gap-1.5">
        <Label htmlFor="name" className="text-sm font-medium">
          Store Name
        </Label>
        <div className="relative">
          <StoreIcon
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="name"
            name="name"
            type="text"
            autoComplete="organization"
            autoFocus
            maxLength={80}
            value={name}
            placeholder="My Awesome Store" onChange={(e) => setName(e.target.value)}
            className="h-11 pl-10"
            required
            aria-invalid={error !== null}
          />
        </div>
      </div>

      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error.message}
        </div>
      )}

      <Button type="submit" variant="clay" size="lg" className="w-full" disabled={isLoading} aria-busy={isLoading}>
        {isLoading ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            <span>Creating store…</span>
          </>
        ) : error?.retryable ? (
          "Try again"
        ) : (
          "Create store"
        )}
      </Button>
    </form>
  );
}
