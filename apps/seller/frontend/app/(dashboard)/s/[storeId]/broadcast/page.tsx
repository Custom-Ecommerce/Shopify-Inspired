"use client";

import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { useEffect, useState } from "react";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Customer {
  id: string;
  phone: string;
  name: string | null;
  optedOut: boolean;
}

/**
 * Phase 7.7 — 3-step composer: message → audience → confirm. See
 * endpoints/broadcast.ts's class comment: nothing is actually sent by
 * this yet (no WhatsApp Business API integration exists anywhere in this
 * codebase) — this UI exists and works end-to-end for everything except
 * the final delivery.
 */
export default function DashboardBroadcastPage() {
  const storeFetch = useStoreFetch();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState<"all" | "30d" | "90d">("all");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (step !== 2) return;
    setLoadingCustomers(true);
    const query = audience === "all" ? "" : `?sinceDays=${audience === "30d" ? 30 : 90}`;
    storeFetch(`/api/dashboard/broadcast/customers${query}`)
      .then((res) => res.json())
      .then((data) => setCustomers(data.docs ?? []))
      .catch(() => setError("Could not reach the backend."))
      .finally(() => setLoadingCustomers(false));
  }, [step, audience, storeFetch]);

  const eligibleCustomers = customers.filter((c) => !c.optedOut);

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      const res = await storeFetch("/api/dashboard/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, customerIds: eligibleCustomers.map((c) => c.id) }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error ?? "Could not send broadcast.");
        return;
      }
      setResult(data);
    } catch {
      setError("Could not reach the backend. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="p-6 sm:p-8 max-w-lg">
      <h1 className="font-heading text-2xl mb-6">Broadcast Message</h1>

      {step === 1 && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">Step 1 of 3 — Message</p>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            maxLength={1024}
            placeholder="Write your WhatsApp broadcast message…"
          />
          <p className="text-xs text-muted-foreground text-right">{message.length}/1024</p>
          <Button
            onClick={() => setStep(2)}
            disabled={!message.trim()}
            className="self-start"
            variant="clay"
          >
            Continue
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">Step 2 of 3 — Audience</p>
          <Tabs value={audience} onValueChange={(v) => { if (v) setAudience(v as "all" | "30d" | "90d"); }}>
            <TabsList>
              <TabsTrigger value="all">All customers</TabsTrigger>
              <TabsTrigger value="30d">Ordered in last 30d</TabsTrigger>
              <TabsTrigger value="90d">Ordered in last 90d</TabsTrigger>
            </TabsList>
          </Tabs>
          {loadingCustomers ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <p className="text-sm">
              {eligibleCustomers.length} recipient{eligibleCustomers.length === 1 ? "" : "s"}
              {customers.length !== eligibleCustomers.length && (
                <span className="text-muted-foreground"> ({customers.length - eligibleCustomers.length} opted out)</span>
              )}
            </p>
          )}
          <div className="flex gap-3">
            <Button variant="clay-soft" onClick={() => setStep(1)}>Back</Button>
            <Button variant="clay" onClick={() => setStep(3)} disabled={eligibleCustomers.length === 0}>
              Continue
            </Button>
          </div>
        </div>
      )}

      {step === 3 && !result && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">Step 3 of 3 — Confirm</p>
          <SectionCard>
            <p className="text-sm mb-2">
              Sending to <span className="font-medium">{eligibleCustomers.length}</span> customers:
            </p>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{message}</p>
          </SectionCard>
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex gap-3">
            <Button variant="clay-soft" onClick={() => setStep(2)}>Back</Button>
            <Button variant="clay" onClick={handleSend} disabled={sending}>
              {sending ? "Sending…" : "Send broadcast"}
            </Button>
          </div>
        </div>
      )}

      {result && (
        <SectionCard>
          <p className="text-sm">
            <span className="text-success font-medium">{result.sent} sent</span>
            {result.failed > 0 && <span className="text-destructive"> · {result.failed} failed</span>}
          </p>
        </SectionCard>
      )}
    </div>
  );
}
