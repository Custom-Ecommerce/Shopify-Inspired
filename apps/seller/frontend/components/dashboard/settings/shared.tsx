"use client";

import { useCallback, useState, type ReactNode } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { FormAlert } from "@/components/auth/AccountCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { useActiveStoreId } from "@/lib/dashboard-context";
import type { StoreSettings } from "@markaz/contracts/store-settings";

/** What a tab gets from the page: the saved settings, a way to save one PATCH body, and a way to say it has unsaved edits. */
export interface TabProps {
  settings: StoreSettings;
  save: (body: Record<string, unknown>) => Promise<SaveResult>;
  onDirty: (dirty: boolean) => void;
}

export type SaveResult = { ok: true } | { ok: false; message: string; field: string | null };

/** The saving state every tab shows: busy, the last message, and the message of the field the server named. */
export function useTabSave(save: TabProps["save"]) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const run = useCallback(
    async (body: Record<string, unknown>, success = "Saved."): Promise<boolean> => {
      setBusy(true);
      setFeedback(null);
      setFieldErrors({});
      const result = await save(body);
      setBusy(false);
      if (result.ok) {
        setFeedback({ tone: "success", text: success });
        return true;
      }
      if (result.field) {
        setFieldErrors({ [result.field]: result.message });
        setFeedback({ tone: "error", text: "Check the field marked below." });
      } else {
        setFeedback({ tone: "error", text: result.message });
      }
      return false;
    },
    [save],
  );

  return { busy, feedback, fieldErrors, run, setFieldErrors, clearFeedback: () => setFeedback(null) };
}

export function SaveBar({ dirty, busy, feedback, label = "Save changes" }: { dirty: boolean; busy: boolean; feedback: { tone: "success" | "error"; text: string } | null; label?: string }) {
  return (
    <div className="flex flex-col gap-3">
      {feedback ? <FormAlert tone={feedback.tone}>{feedback.text}</FormAlert> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={busy || !dirty} aria-busy={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {label}
        </Button>
        {dirty && !busy ? <span className="text-sm text-muted-foreground">You have unsaved changes.</span> : null}
      </div>
    </div>
  );
}

export function Field({
  id,
  label,
  error,
  hint,
  counter,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  counter?: { used: number; max: number };
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {counter ? (
          <span className={"text-xs " + (counter.used > counter.max ? "font-medium text-destructive" : "text-muted-foreground")} aria-live="polite">
            {counter.used}/{counter.max}
          </span>
        ) : null}
      </div>
      {children}
      {error ? (
        <p id={id + "-error"} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  counter,
  ...input
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  counter?: { used: number; max: number };
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "id">) {
  return (
    <Field id={id} label={label} error={error} hint={hint} counter={counter}>
      <Input id={id} className="h-11" value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={error !== undefined} aria-describedby={error ? id + "-error" : undefined} {...input} />
    </Field>
  );
}

export interface UploadedImage {
  id: string;
  url: string | null;
}

/** An image the seller picks: uploaded at once through /api/proxy/media, previewed, and saved with the form (the id is what is stored). */
export function ImageUpload({
  label,
  value,
  onChange,
  alt,
  shape = "square",
  error,
}: {
  label: string;
  value: UploadedImage | null;
  onChange: (value: UploadedImage | null) => void;
  alt: string;
  shape?: "square" | "wide";
  error?: string;
}) {
  const storeFetch = useStoreFetch();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setProblem(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("alt", alt);
      const res = await storeFetch("/api/proxy/media", { method: "POST", body });
      const data = (await res.json().catch(() => null)) as { error?: unknown; doc?: { id?: unknown; url?: unknown }; id?: unknown; url?: unknown } | null;
      const doc = data?.doc ?? data;
      if (!res.ok || typeof doc?.id !== "string") {
        setProblem(typeof data?.error === "string" ? data.error : "The image could not be uploaded.");
        return;
      }
      onChange({ id: doc.id, url: typeof doc.url === "string" ? doc.url : null });
    } catch {
      setProblem("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const frame = shape === "wide" ? "aspect-[3/1] w-full max-w-md" : "size-24";
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div className={"flex items-center justify-center overflow-hidden rounded-lg border bg-muted/40 " + frame}>
        {value?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value.url} alt={alt} className="size-full object-cover" />
        ) : (
          <ImagePlus className="size-6 text-muted-foreground" aria-hidden="true" />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border px-3 text-sm font-medium">
          {busy ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
          {value ? "Replace" : "Upload"}
          <input type="file" accept="image/*" className="sr-only" disabled={busy} onChange={pick} />
        </Label>
        {value ? (
          <Button type="button" variant="ghost" className="min-h-11" onClick={() => onChange(null)}>
            Remove
          </Button>
        ) : null}
      </div>
      {problem || error ? <p className="text-sm text-destructive">{problem ?? error}</p> : null}
    </div>
  );
}
