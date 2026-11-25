"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FLOW_COPY, FLOW_ENDPOINTS, flowBody, flowProblems, readFlowAnswer, type FlowProblems, type PasswordFlow } from "@/lib/password-flow";

/** One form for the three public flows (CO-77, S6-B6): forgot, reset and accept-invite. The token comes from the link, never from a field. */
export function PasswordFlowForm({ flow, token = null }: { flow: PasswordFlow; token?: string | null }) {
  const copy = FLOW_COPY[flow];
  const [form, setForm] = useState({ email: "", password: "", confirm: "" });
  const [problems, setProblems] = useState<FlowProblems>({});
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const found = flowProblems(flow, form, token);
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    setPending(true);
    try {
      const response = await fetch(FLOW_ENDPOINTS[flow], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(flowBody(flow, form, token)) });
      const answer = await readFlowAnswer(flow, response);
      setResult(answer);
      if (!answer.ok && answer.field !== null) setProblems({ [answer.field]: answer.message } as FlowProblems);
    } catch {
      setResult({ ok: false, message: "Could not reach the console. Check your connection." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-4" data-flow={flow}>
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight">{copy.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{copy.hint}</p>
      </div>
      {result?.ok ? (
        <div role="status" className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <p>{result.message}</p>
          <Link href="/login" className="mt-2 inline-block text-primary underline-offset-4 hover:underline">
            Go to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
          {flow === "forgot" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="flow-email">Email</Label>
              <Input id="flow-email" type="email" autoComplete="email" className="min-h-11" value={form.email} aria-invalid={problems.email !== undefined} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              {problems.email ? <p role="alert" className="text-sm text-destructive">{problems.email}</p> : null}
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="flow-password">New password</Label>
                <Input id="flow-password" type="password" autoComplete="new-password" className="min-h-11" value={form.password} aria-invalid={problems.password !== undefined} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
                {problems.password ? <p role="alert" className="text-sm text-destructive">{problems.password}</p> : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="flow-confirm">Repeat the password</Label>
                <Input id="flow-confirm" type="password" autoComplete="new-password" className="min-h-11" value={form.confirm} aria-invalid={problems.confirm !== undefined} onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))} />
                {problems.confirm ? <p role="alert" className="text-sm text-destructive">{problems.confirm}</p> : null}
              </div>
              {problems.token ? <p role="alert" className="text-sm text-destructive">{problems.token}</p> : null}
            </>
          )}
          {result && !result.ok ? <p role="alert" className="text-sm text-destructive">{result.message}</p> : null}
          <Button type="submit" className="min-h-11" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {copy.button}
          </Button>
          <Link href="/login" className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </form>
      )}
    </div>
  );
}
