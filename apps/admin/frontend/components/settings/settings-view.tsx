"use client";

import { TriangleAlert } from "lucide-react";
import { SettingsForm } from "@/components/settings/settings-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getSettings } from "@/lib/api/client";
import { useAdminFetch } from "@/lib/hooks/use-admin-fetch";

function SettingsSkeleton() {
  return (
    <Card aria-busy="true" aria-label="Loading settings">
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full max-w-md" />
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </CardContent>
    </Card>
  );
}

/** The platform settings at /settings: loading skeleton, error with retry, then the form. */
export function SettingsView() {
  const { data, error, loading, refetch } = useAdminFetch((signal) => getSettings(signal), []);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h2 className="font-heading mb-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Settings</h2>
        <p className="text-sm text-muted-foreground">Platform-wide settings. Every change is recorded in the audit log with your name and reason.</p>
      </div>

      {data !== null && error !== null ? (
        <Card role="alert" className="flex flex-wrap items-center justify-between gap-3 border-destructive/20 bg-destructive/8 px-5 py-4">
          <p className="text-sm text-destructive">{error.message}</p>
          <Button variant="outline" size="sm" onClick={refetch} disabled={loading}>
            Try again
          </Button>
        </Card>
      ) : null}

      {data !== null ? (
        <SettingsForm key={data.settingsRevision} settings={data} onReload={refetch} />
      ) : error !== null ? (
        <Card role="alert" className="flex flex-col items-center gap-4 border-destructive/20 bg-destructive/8 px-6 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/10">
            <TriangleAlert className="size-6 text-destructive" aria-hidden />
          </span>
          <p className="max-w-sm text-sm font-medium text-foreground">{error.message}</p>
          <Button variant="outline" size="sm" onClick={refetch}>
            Try again
          </Button>
        </Card>
      ) : (
        <SettingsSkeleton />
      )}
    </div>
  );
}
