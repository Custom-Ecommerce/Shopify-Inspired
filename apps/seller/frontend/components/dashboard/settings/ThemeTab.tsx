"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { FormAlert } from "@/components/auth/AccountCard";
import { PreviewStoreButton } from "@/components/dashboard/PreviewStoreButton";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { cn } from "@/lib/utils";
import { unavailableThemeNotice } from "@/lib/theme-notice";
import { SaveBar, useTabSave, type TabProps } from "./shared";
import { ThemeConfigEditor } from "./ThemeConfigEditor";
import { RESET_BODY, SAVED_TEXT, defaultForm, formFromConfig, formProblems, isConfigDirty, isDefaultForm, themeConfigPatch, type ThemeConfigForm, type ThemeConfigRead } from "@/lib/theme-config-form";

interface ThemeOption {
  slug: string;
  name: string;
  tier: string;
  previewImage: string | null;
  isDefaultForNewStores: boolean;
  supportsCardCheckout?: boolean;
  /** S7-B7 (D-118): a premium theme (paid tier) and whether this seller plan locks it. No theme is premium today; Stiletto is free. */
  premium?: boolean;
  locked?: boolean;
}

/** Sprint 7 (CO-81): a theme's static preview image. A file that does not load is left out, so a broken picture never shows. */
function ThemePreviewImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} data-testid="theme-preview-image" className="aspect-[4/3] w-full rounded-lg border bg-muted/30 object-cover" />
  );
}

/** Theme: the themes a seller can choose from GET /api/themes (today Stiletto), a link to the existing store preview, and a save. */
export function ThemeTab({ settings, save, onDirty }: TabProps) {
  const storeFetch = useStoreFetch();
  const [themes, setThemes] = useState<ThemeOption[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [active, setActive] = useState(settings.theme.activeTheme);
  const form = useTabSave(save);

  // Sprint 7 (S7-B7): the look editor has its own form and save (the settings group "themeConfig"). The server keeps ONE live version of it, so "preview before
  // saving" is the small drawing inside the editor; after saving, the preview button above shows the real store.
  const savedConfig = formFromConfig((settings as { themeConfig?: ThemeConfigRead }).themeConfig);
  const [config, setConfig] = useState<ThemeConfigForm>(savedConfig);
  const configForm = useTabSave(save);
  const savedConfigKey = JSON.stringify(savedConfig);
  useEffect(() => setConfig(savedConfig), [savedConfigKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const configDirty = isConfigDirty(savedConfig, config);

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
  useEffect(() => onDirty(dirty || configDirty), [dirty, configDirty, onDirty]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    await form.run({ theme: { activeTheme: active } }, "Theme saved. Open the preview to see it.");
  }

  async function onSaveConfig(event: React.FormEvent) {
    event.preventDefault();
    if (Object.keys(formProblems(config)).length > 0) return;
    const body = themeConfigPatch(savedConfig, config);
    if (body === null) return;
    await configForm.run({ themeConfig: body }, SAVED_TEXT);
  }

  async function onResetConfig() {
    // Reset to defaults is saved at once: the whole group null, which the server stores as no config.
    const ok = await configForm.run({ ...RESET_BODY }, "The look is back to the defaults.");
    if (ok) setConfig(defaultForm());
  }

  const notice = unavailableThemeNotice(settings.theme.unavailableTheme, themes?.find((theme) => theme.slug === settings.theme.activeTheme)?.name ?? "Stiletto");

  return (
    <div className="flex flex-col gap-8">
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <SectionCard title="Theme" description="The look of your storefront. Your products and settings stay the same.">
        {notice ? (
          <div className="mb-4">
            <FormAlert tone="info">{notice}</FormAlert>
          </div>
        ) : null}
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
                  <input type="radio" name="theme" className="sr-only" checked={selected} disabled={theme.locked === true} onChange={() => setActive(theme.slug)} />
                  {theme.previewImage ? <ThemePreviewImage src={theme.previewImage} /> : null}
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{theme.name}</span>
                    {selected ? <Check className="size-4 text-primary" aria-label="Selected" /> : null}
                  </span>
                  <span className="text-xs capitalize text-muted-foreground">{theme.tier}{theme.isDefaultForNewStores ? " · default for new stores" : ""}</span>
                {theme.locked ? <span className="text-xs text-muted-foreground">Needs the Growth plan.</span> : null}
                </label>
              );
            })}
          </fieldset>
        )}
        {form.fieldErrors["theme.activeTheme"] ? (
          <div className="mt-4">
            <FormAlert tone="error">{form.fieldErrors["theme.activeTheme"]}</FormAlert>
          </div>
        ) : null}
        <div className="mt-5 grid max-w-xs gap-2">
          <p className="text-sm text-muted-foreground">The preview shows the saved theme. Save first, then preview.</p>
          <PreviewStoreButton />
        </div>
      </SectionCard>
      <SaveBar dirty={dirty} busy={form.busy} feedback={form.feedback} />
    </form>

    <form onSubmit={onSaveConfig} className="flex flex-col gap-6" noValidate>
      <ThemeConfigEditor
        form={config}
        onChange={setConfig}
        onReset={() => void onResetConfig()}
        errors={configForm.fieldErrors}
        busy={configForm.busy}
        resetDisabled={isDefaultForm(savedConfig) && isDefaultForm(config)}
        storeName={settings.profile.name}
      />
      <SaveBar dirty={configDirty && Object.keys(formProblems(config)).length === 0} busy={configForm.busy} feedback={configForm.feedback} label="Save the look" />
    </form>
    </div>
  );
}

