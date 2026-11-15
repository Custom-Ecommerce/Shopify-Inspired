"use client";

import { useEffect, useState } from "react";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { Textarea } from "@/components/ui/textarea";
import { counter, groupPatch, textOf } from "@/lib/store-settings-form";
import { Field, ImageUpload, SaveBar, TextField, useTabSave, type TabProps, type UploadedImage } from "./shared";

const DESCRIPTION_MAX = 1000;

/** Profile and branding: name, description, contact details, city, logo and banner. One PATCH with the changed fields only. */
export function ProfileTab({ settings, save, onDirty }: TabProps) {
  const saved = {
    name: settings.profile.name,
    description: textOf(settings.profile.description),
    contactPhone: textOf(settings.profile.contactPhone),
    whatsappNumber: textOf(settings.profile.whatsappNumber),
    contactEmail: textOf(settings.profile.contactEmail),
    address: textOf(settings.profile.address),
    city: textOf(settings.profile.city),
  };
  const [draft, setDraft] = useState(saved);
  const [logo, setLogo] = useState<UploadedImage | null>(settings.branding.logo);
  const [banner, setBanner] = useState<UploadedImage | null>(settings.branding.banner);
  const form = useTabSave(save);

  const profilePatch = groupPatch(saved, draft);
  const brandingPatch: Record<string, string | null> = {};
  if ((logo?.id ?? null) !== (settings.branding.logo?.id ?? null)) brandingPatch.logo = logo?.id ?? null;
  if ((banner?.id ?? null) !== (settings.branding.banner?.id ?? null)) brandingPatch.banner = banner?.id ?? null;
  const dirty = profilePatch !== null || Object.keys(brandingPatch).length > 0;

  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  // After a save the server's answer (a normalised phone, for one) is the new baseline.
  useEffect(() => {
    setDraft(saved);
    setLogo(settings.branding.logo);
    setBanner(settings.branding.banner);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.updatedAt]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const body: Record<string, unknown> = {};
    if (profilePatch) body.profile = profilePatch;
    if (Object.keys(brandingPatch).length > 0) body.branding = brandingPatch;
    await form.run(body, "Profile saved.");
  }

  const set = (key: keyof typeof draft) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const err = (path: string) => form.fieldErrors[path];

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <SectionCard title="Store details" description="Shoppers see these on your storefront header, footer and contact area.">
        <div className="flex flex-col gap-4">
          <TextField id="name" label="Store name" value={draft.name} onChange={set("name")} error={err("profile.name")} maxLength={120} autoComplete="organization" />
          <Field id="description" label="Description" counter={{ used: counter(draft.description, DESCRIPTION_MAX).used, max: DESCRIPTION_MAX }} error={err("profile.description")}>
            <Textarea id="description" rows={4} value={draft.description} onChange={(event) => set("description")(event.target.value)} aria-invalid={err("profile.description") !== undefined} />
          </Field>
          <TextField id="contactPhone" label="Phone number" type="tel" inputMode="tel" placeholder="0300 1234567" value={draft.contactPhone} onChange={set("contactPhone")} error={err("profile.contactPhone")} />
          <TextField id="whatsappNumber" label="WhatsApp number" type="tel" inputMode="tel" placeholder="0300 1234567" value={draft.whatsappNumber} onChange={set("whatsappNumber")} error={err("profile.whatsappNumber")} hint="Shown as the WhatsApp chat button. Leave empty to hide it." />
          <TextField id="contactEmail" label="Contact email" type="email" value={draft.contactEmail} onChange={set("contactEmail")} error={err("profile.contactEmail")} />
          <TextField id="city" label="City" value={draft.city} onChange={set("city")} error={err("profile.city")} autoComplete="address-level2" />
          <TextField id="address" label="Address" value={draft.address} onChange={set("address")} error={err("profile.address")} autoComplete="street-address" />
        </div>
      </SectionCard>

      <SectionCard title="Branding" description="Your logo and the banner at the top of your store.">
        <div className="flex flex-col gap-5">
          <ImageUpload label="Logo" value={logo} onChange={setLogo} alt={settings.profile.name + " logo"} error={err("branding.logo")} />
          <ImageUpload label="Banner" value={banner} onChange={setBanner} alt={settings.profile.name + " banner"} shape="wide" error={err("branding.banner")} />
        </div>
      </SectionCard>

      <SaveBar dirty={dirty} busy={form.busy} feedback={form.feedback} />
    </form>
  );
}
