"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { FormAlert } from "@/components/auth/AccountCard";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveStoreId } from "@/lib/dashboard-context";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import type { StoreSettings } from "@markaz/contracts/store-settings";
import { DeliveryTab } from "./DeliveryTab";
import { FraudTab } from "./FraudTab";
import { MessagesTab } from "./MessagesTab";
import { PaymentsTab } from "./PaymentsTab";
import { ProfileTab } from "./ProfileTab";
import { SeoTab } from "./SeoTab";
import type { SaveResult } from "./shared";
import { ThemeTab } from "./ThemeTab";

export const SETTINGS_TABS = [
  { value: "profile", label: "Profile & Branding" },
  { value: "delivery", label: "Delivery" },
  { value: "payments", label: "Payments" },
  { value: "theme", label: "Theme" },
  { value: "seo", label: "SEO & Social" },
  { value: "messages", label: "Messages" },
  // Sprint 5 EP-11: phone confirmation, risk rules and the blocklist link.
  { value: "fraud", label: "Fraud" },
] as const;

type TabValue = (typeof SETTINGS_TABS)[number]["value"];

const UNSAVED = "You have unsaved changes on this tab. Leave without saving?";

function isTab(value: string | null): value is TabValue {
  return SETTINGS_TABS.some((tab) => tab.value === value);
}

/**
 * Sprint 4 EP-04: the store settings screen. Loads GET .../settings once, saves one group at a time with the grouped PATCH
 * body, and keeps the saved copy the server answers with. An edit that is not saved is guarded when the tab is changed and
 * when the page is closed or reloaded.
 */
export function StoreSettingsView() {
  const storeId = useActiveStoreId();
  const storeFetch = useStoreFetch();
  const params = useSearchParams();
  const requested = params.get("tab");
  const [tab, setTab] = useState<TabValue>(isTab(requested) ? requested : "profile");
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const [, force] = useState(0);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await storeFetch(`/api/proxy/stores/${encodeURIComponent(storeId)}/settings`, { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as { settings?: StoreSettings; error?: string } | null;
      if (!res.ok || !data?.settings) {
        setLoadError(data?.error ?? "The settings could not be loaded.");
        return;
      }
      setSettings(data.settings);
    } catch {
      setLoadError("Could not reach the server. Please try again.");
    }
  }, [storeFetch, storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (body: Record<string, unknown>): Promise<SaveResult> => {
      try {
        const res = await storeFetch(`/api/proxy/stores/${encodeURIComponent(storeId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => null)) as { settings?: StoreSettings; error?: string; field?: string } | null;
        if (!res.ok || !data?.settings) {
          return { ok: false, message: data?.error ?? "The settings could not be saved.", field: typeof data?.field === "string" ? data.field : null };
        }
        setSettings(data.settings);
        return { ok: true };
      } catch {
        return { ok: false, message: "Could not reach the server. Please try again.", field: null };
      }
    },
    [storeFetch, storeId],
  );

  const onDirty = useCallback((dirty: boolean) => {
    if (dirtyRef.current !== dirty) {
      dirtyRef.current = dirty;
      force((n) => n + 1);
    }
  }, []);

  // Closing or reloading the page with unsaved edits asks first.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  function changeTab(next: string) {
    if (!isTab(next) || next === tab) return;
    if (dirtyRef.current && !window.confirm(UNSAVED)) return;
    dirtyRef.current = false;
    setTab(next);
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <PageHeader title="Store Settings" description={settings?.profile.name ?? "Your store details, delivery, payments, theme and search."} className="mb-0" />

      {loadError ? (
        <FormAlert tone="error">
          {loadError}{" "}
          <button type="button" className="font-medium underline" onClick={() => void load()}>
            Try again
          </button>
        </FormAlert>
      ) : settings === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading…
        </p>
      ) : (
        <>
          <Tabs value={tab} onValueChange={(value) => changeTab(String(value))}>
            <TabsList className="w-full justify-start" aria-label="Settings sections">
              {SETTINGS_TABS.map((item) => (
                <TabsTrigger key={item.value} value={item.value} className="min-h-9 whitespace-nowrap">
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {tab === "profile" ? <ProfileTab settings={settings} save={save} onDirty={onDirty} /> : null}
          {tab === "delivery" ? <DeliveryTab settings={settings} save={save} onDirty={onDirty} /> : null}
          {tab === "payments" ? <PaymentsTab settings={settings} save={save} onDirty={onDirty} /> : null}
          {tab === "theme" ? <ThemeTab settings={settings} save={save} onDirty={onDirty} /> : null}
          {tab === "seo" ? <SeoTab settings={settings} save={save} onDirty={onDirty} /> : null}
          {tab === "messages" ? <MessagesTab settings={settings} save={save} onDirty={onDirty} /> : null}
          {tab === "fraud" ? <FraudTab settings={settings} save={save} onDirty={onDirty} /> : null}
        </>
      )}
    </div>
  );
}
