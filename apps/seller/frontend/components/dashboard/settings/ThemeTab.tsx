"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { FormAlert } from "@/components/auth/AccountCard";
import { PreviewStoreButton } from "@/components/dashboard/PreviewStoreButton";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { cn } from "@/lib/utils";
import { SaveBar, useTabSave, type TabProps } from "./shared";

interface ThemeOption {
  slug: string;
  name: string;
  tier: string;
  previewImage: string | null;
  isDefaultForNewStores: boolean;
}

/** Theme: the installed themes from GET /api/themes, a link to the existing store preview, and a save. */
export function ThemeTab({ settings, save, onDirty }: TabProps) {
  const storeFetch = useStoreFetch();
  const [themes, setThemes] = useState<ThemeOption[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [active, setActive] = useState(settings.theme.activeTheme);
  const form = useTabSave(save);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await storeFetch("/api/proxy/themes", { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as { themes?: ThemeOption[] } | null;
        if (cancelled) return;
        if (!res.ok || !Array.isArray(data?.themes)) setLoadError(true);
        else setThemes(data.themes);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeFetch]);

  useEffect(() => setActive(settings.theme.activeTheme), [settings.theme.activeTheme]);
  const dirty = active !== settings.theme.activeTheme;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    await form.run({ theme: { activeTheme: active } }, "Theme saved. Open the preview to see it.");
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <SectionCard title="Theme" description="The look of your storefront. Your products and settings stay the same.">
        {loadError ? (
          <FormAlert tone="error">The themes could not be loaded. Reload the page.</FormAlert>
        ) : themes === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading themes…
          </p>
        ) : (
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">Choose a theme</legend>
            {themes.map((theme) => {
              const selected = active === theme.slug;
              return (
                <label key={theme.slug} className={cn("flex min-h-11 cursor-pointer flex-col gap-2 rounded-xl border p-3", selected ? "border-primary bg-primary/5" : "hover:bg-muted/40")}>
                  <input type="radio" name="theme" className="sr-only" checked={selected} onChange={() => setActive(theme.slug)} />
                  {theme.previewImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={theme.previewImage} alt="" className="aspect-[4/3] w-full rounded-lg object-cover" />
                  ) : null}
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{theme.name}</span>
                    {selected ? <Check className="size-4 text-primary" aria-label="Selected" /> : null}
                  </span>
                  <span className="text-xs capitalize text-muted-foreground">{theme.tier}{theme.isDefaultForNewStores ? " · default for new stores" : ""}</span>
                </label>
              );
            })}
          </fieldset>
        )}
        <div className="mt-5 grid max-w-xs gap-2">
          <p className="text-sm text-muted-foreground">The preview shows the saved theme. Save first, then preview.</p>
          <PreviewStoreButton />
        </div>
      </SectionCard>
      <SaveBar dirty={dirty} busy={form.busy} feedback={form.feedback} />
    </form>
  );
}
