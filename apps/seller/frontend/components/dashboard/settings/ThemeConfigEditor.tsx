"use client";

import type { CSSProperties } from "react";
import { useState } from "react";
import { ImageIcon, RotateCcw, X } from "lucide-react";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { FormAlert } from "@/components/auth/AccountCard";
import { MediaPickerDialog } from "@/components/dashboard/media/MediaPickerDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  FONT_LABELS,
  THEME_ANNOUNCEMENT_MAX,
  THEME_FONT_FAMILIES,
  THEME_HERO_CTA_LABEL_MAX,
  THEME_HERO_SUBTITLE_MAX,
  THEME_HERO_TITLE_MAX,
  checkColor,
  formProblems,
  previewOf,
  type ThemeConfigForm,
} from "@/lib/theme-config-form";
import { Field, TextField } from "./shared";

/**
 * Sprint 7 (S7-B7): the Stiletto look editor: two colours (a picker and a hex box), a font from a short list, the home hero (title, subtitle, picture, button),
 * the announcement bar and four section switches. "Reset to defaults", a small preview that updates as you type (no iframe: the same validated style the storefront
 * uses, drawn here), and the server's field errors under each field. The editor holds no state of its own: the Theme tab owns the form and the save.
 */

function ColourField({ id, label, value, onChange, error }: { id: string; label: string; value: string; onChange: (value: string) => void; error?: string }) {
  const check = checkColor(value);
  const message = error ?? (check.ok ? undefined : check.message);
  return (
    <Field id={id} label={label} error={message}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label + " picker"}
          value={check.ok ? check.normalized : "#000000"}
          onChange={(event) => onChange(event.target.value)}
          className="size-11 shrink-0 cursor-pointer rounded-lg border bg-transparent p-1"
        />
        <Input id={id} className="h-11 font-mono" value={value} maxLength={7} onChange={(event) => onChange(event.target.value)} aria-invalid={message !== undefined} aria-describedby={message ? id + "-error" : undefined} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      </div>
    </Field>
  );
}

function Switch({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm">
      <input id={id} type="checkbox" className="mt-1 size-4" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <span className="block font-medium">{label}</span>
        {hint ? <span className="block text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

export function ThemeConfigEditor({
  form,
  onChange,
  onReset,
  errors,
  busy,
  resetDisabled,
  storeName,
}: {
  form: ThemeConfigForm;
  onChange: (next: ThemeConfigForm) => void;
  onReset: () => void;
  errors: Record<string, string>;
  busy: boolean;
  resetDisabled: boolean;
  storeName: string;
}) {
  const [picking, setPicking] = useState(false);
  const set = <K extends keyof ThemeConfigForm>(key: K, value: ThemeConfigForm[K]) => onChange({ ...form, [key]: value });
  const problems = formProblems(form);
  const err = (field: string): string | undefined => errors["themeConfig." + field] ?? problems["themeConfig." + field];
  const preview = previewOf(form, storeName);

  return (
    <SectionCard title="Customise the look" description="Change the colours, the font and the top of your home page. Your products and settings stay the same.">
      <div className="grid gap-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <ColourField id="tc-primary" label="Main colour" value={form.primaryColor} onChange={(value) => set("primaryColor", value)} error={errors["themeConfig.primaryColor"]} />
          <ColourField id="tc-accent" label="Accent colour" value={form.accentColor} onChange={(value) => set("accentColor", value)} error={errors["themeConfig.accentColor"]} />
        </div>

        <Field id="tc-font" label="Font" error={errors["themeConfig.fontFamily"]} hint="Choose from the list. Stiletto keeps its own fonts unless you pick another.">
          <select
            id="tc-font"
            className="h-11 w-full rounded-lg border bg-background px-3 text-sm"
            value={form.fontFamily}
            onChange={(event) => set("fontFamily", event.target.value as ThemeConfigForm["fontFamily"])}
          >
            {THEME_FONT_FAMILIES.map((family) => (
              <option key={family} value={family}>
                {FONT_LABELS[family]}
              </option>
            ))}
          </select>
        </Field>

        <fieldset className="grid gap-4">
          <legend className="mb-1 text-sm font-medium">Top of your home page</legend>
          <TextField id="tc-hero-title" label="Title" value={form.heroTitle} onChange={(value) => set("heroTitle", value)} error={err("heroTitle")} counter={{ used: form.heroTitle.length, max: THEME_HERO_TITLE_MAX }} hint="Leave empty to keep Stiletto's own title." />
          <TextField id="tc-hero-subtitle" label="Subtitle" value={form.heroSubtitle} onChange={(value) => set("heroSubtitle", value)} error={err("heroSubtitle")} counter={{ used: form.heroSubtitle.length, max: THEME_HERO_SUBTITLE_MAX }} />
          <div className="grid gap-2">
            <Label>Picture</Label>
            {form.heroImage?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.heroImage.url} alt="" className="aspect-[16/7] w-full rounded-lg border object-cover" />
            ) : (
              <p className="text-sm text-muted-foreground">No picture. The theme&apos;s own video shows.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setPicking(true)}>
                <ImageIcon className="size-4" aria-hidden="true" /> {form.heroImage ? "Change picture" : "Choose a picture"}
              </Button>
              {form.heroImage ? (
                <Button type="button" variant="ghost" className="min-h-11" onClick={() => set("heroImage", null)}>
                  <X className="size-4" aria-hidden="true" /> Remove
                </Button>
              ) : null}
            </div>
            {errors["themeConfig.heroImage"] ? <p className="text-sm text-destructive">{errors["themeConfig.heroImage"]}</p> : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField id="tc-cta-label" label="Button text" value={form.heroCtaLabel} onChange={(value) => set("heroCtaLabel", value)} error={err("heroCtaLabel")} counter={{ used: form.heroCtaLabel.length, max: THEME_HERO_CTA_LABEL_MAX }} />
            <TextField id="tc-cta-link" label="Button link" value={form.heroCtaLink} onChange={(value) => set("heroCtaLink", value)} error={err("heroCtaLink")} hint="For example /products, or a full https:// address." autoCapitalize="none" autoCorrect="off" />
          </div>
        </fieldset>

        <fieldset className="grid gap-3">
          <legend className="mb-1 text-sm font-medium">Announcement bar</legend>
          <Switch id="tc-ann-on" label="Show the announcement bar" checked={form.announcementEnabled} onChange={(value) => set("announcementEnabled", value)} />
          <TextField id="tc-ann-text" label="Announcement" value={form.announcementText} onChange={(value) => set("announcementText", value)} error={err("announcementText")} counter={{ used: form.announcementText.length, max: THEME_ANNOUNCEMENT_MAX }} hint="Leave empty to keep the text from your store settings." disabled={!form.announcementEnabled} />
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-medium sm:col-span-2">Sections of your home page</legend>
          <Switch id="tc-categories" label="Shop by category" checked={form.showCategories} onChange={(value) => set("showCategories", value)} />
          <Switch id="tc-featured" label="Featured products" checked={form.showFeatured} onChange={(value) => set("showFeatured", value)} />
          <Switch id="tc-reviews" label="Reviews" checked={form.showReviews} onChange={(value) => set("showReviews", value)} />
          <Switch id="tc-blog" label="Blog link in the footer" hint="Only matters when you have a published article." checked={form.showBlog} onChange={(value) => set("showBlog", value)} />
        </fieldset>

        <div className="grid gap-2" aria-label="Preview">
          <p className="text-sm font-medium">Preview (not saved yet)</p>
          {/* A small drawing of the Stiletto header and hero from the form as typed: text nodes and a style OBJECT built from validated values only. */}
          <div className="overflow-hidden rounded-xl border text-white" style={preview.style as CSSProperties} data-testid="theme-config-preview">
            {preview.announcement ? <div className="bg-black px-3 py-1.5 text-center text-[11px]">{preview.announcement}</div> : null}
            <div className="flex items-center justify-between px-3 py-2 text-xs" style={{ background: "var(--brand-primary, #111111)" }}>
              <span className="font-semibold">{storeName}</span>
              <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: "var(--nav-cart-badge-bg, #000000)" }}>
                Cart 0
              </span>
            </div>
            <div className="relative flex min-h-36 flex-col items-center justify-center gap-2 overflow-hidden bg-neutral-700 px-4 py-6 text-center">
              {preview.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.imageUrl} alt="" className="absolute inset-0 size-full object-cover" />
              ) : null}
              <p className="relative z-10 break-words text-lg font-bold uppercase leading-tight" style={{ fontFamily: "var(--custom-heading, inherit)" }}>{preview.title}</p>
              <p className="relative z-10 break-words text-xs opacity-90" style={{ fontFamily: "var(--custom-sans, inherit)" }}>{preview.subtitle}</p>
              <span className="relative z-10 rounded-md px-3 py-1.5 text-[11px] font-bold uppercase" style={{ background: "var(--promo-banner-button-bg, #633e2b)" }}>{preview.button}</span>
            </div>
            <ul className="flex flex-wrap gap-x-3 gap-y-1 bg-white px-3 py-2 text-[11px] text-neutral-800">
              {preview.sections.map((section) => (
                <li key={section.key} className={section.on ? "" : "line-through opacity-50"}>
                  {section.label}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">A drawing to help you choose. Save, then use the preview button above to see your real store.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" onClick={onReset} disabled={busy || resetDisabled}>
            <RotateCcw className="size-4" aria-hidden="true" /> Reset to defaults
          </Button>
        </div>
        {Object.keys(problems).length > 0 ? <FormAlert tone="error">Fix the fields marked above, then save.</FormAlert> : null}
      </div>
      <MediaPickerDialog
        open={picking}
        onOpenChange={setPicking}
        title="Choose the hero picture"
        onPick={(item) => {
          set("heroImage", { id: item.id, url: item.url });
          setPicking(false);
        }}
      />
    </SectionCard>
  );
}
