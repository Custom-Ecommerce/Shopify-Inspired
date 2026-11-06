"use client";

import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { useState } from "react";
import { useDashboard } from "@/lib/dashboard-context";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { StatusBadge } from "@/components/dashboard/shared/StatusBadge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";

interface DnsRecord {
  type: string;
  name: string;
  value: string;
}

interface ConnectResult {
  domain?: string;
  customDomainStatus?: string;
  vercelConfigured?: boolean;
  dnsRecords?: DnsRecord[];
  message?: string;
  error?: string;
}

export default function DashboardDomainPage() {
  const storeFetch = useStoreFetch();
  const { store, storeId } = useDashboard();
  const [domain, setDomain] = useState("");
  const [result, setResult] = useState<ConnectResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"connect" | "verify">(
    store?.domain ? "verify" : "connect"
  );

  if (!store) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="font-heading text-2xl font-semibold mb-2">Domain</h1>
        <p className="text-sm text-muted-foreground">Store details could not be loaded. Try refreshing the page.</p>
      </div>
    );
  }

  async function handleConnect() {
    if (!domain.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await storeFetch("/api/proxy/domain/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, domain: domain.trim().toLowerCase() }),
      });
      const data: ConnectResult = await res.json();
      setResult(data);
      if (!data.error) setStep("verify");
    } catch {
      setResult({ error: "Could not reach the backend. Please try again." });
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    setLoading(true);
    setResult(null);
    try {
      const res = await storeFetch("/api/proxy/domain/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, domain: (store?.domain || domain).trim().toLowerCase() }),
      });
      const data: ConnectResult = await res.json();
      setResult(data);
    } catch {
      setResult({ error: "Could not reach the backend. Please try again." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="p-6 sm:p-8 max-w-lg flex flex-col gap-6">
      <PageHeader
        title="Connect a custom domain"
        className="mb-0"
        description={`Point your own domain (e.g. shop.yourbrand.pk) at ${store.name}.`}
      />

      <SectionCard>
        <div className="flex flex-col gap-4">
          <div>
            <Label className="block text-xs font-medium text-muted-foreground mb-1">
              Your domain (no https://)
            </Label>
            <Input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="shop.yourbrand.pk"
              disabled={step === "verify"}
              className="font-mono"
            />
          </div>

          <div className="flex gap-3 pt-1">
            {step === "connect" ? (
              <Button
                variant="clay"
                onClick={handleConnect}
                disabled={loading || !domain.trim()}
                className="flex-1"
              >
                {loading ? "Connecting…" : "Connect domain"}
              </Button>
            ) : (
              <>
                <Button
                  variant="clay"
                  onClick={handleVerify}
                  disabled={loading}
                  className="flex-1"
                >
                  {loading ? "Checking…" : "Verify now"}
                </Button>
                <Button
                  variant="clay-soft"
                  onClick={() => { setStep("connect"); setResult(null); }}
                >
                  Change domain
                </Button>
              </>
            )}
          </div>
        </div>
      </SectionCard>

      {result && (
        <SectionCard>
          {result.error ? (
            <p className="text-sm text-destructive">{result.error}</p>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-mono">{result.domain}</span>
                <StatusBadge status={result.customDomainStatus ?? "unset"} />
              </div>

              {result.vercelConfigured === false && result.message && (
                <p className="text-xs rounded-xl px-3 py-2 bg-warning/10 text-warning">
                  {result.message} — DNS records below are the standard Vercel values for your domain type.
                </p>
              )}

              {result.customDomainStatus === "verified" && (
                <p className="text-sm text-success">
                  ✓ Domain verified. Your store is now live at{" "}
                  <a
                    href={`https://${result.domain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    {result.domain}
                  </a>
                  .
                </p>
              )}

              {result.customDomainStatus === "failed" && (
                <p className="text-sm text-destructive">
                  DNS not detected yet. Make sure you&apos;ve added the record below, then try &quot;Verify
                  now&quot; again. DNS changes can take a few minutes to a few hours to propagate.
                </p>
              )}

              {result.customDomainStatus === "pending" && (
                <p className="text-sm text-muted-foreground">
                  Add the DNS record below at your domain registrar, then click &quot;Verify now&quot;. This
                  can take a few minutes to a few hours.
                </p>
              )}

              {result.dnsRecords && result.dnsRecords.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                    DNS record to add
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.dnsRecords.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-muted-foreground">{r.type}</TableCell>
                          <TableCell className="font-mono">{r.name}</TableCell>
                          <TableCell className="font-mono break-all">{r.value}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </SectionCard>
      )}
    </main>
  );
}
