"use client";

import { useEffect, useState } from "react";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { Textarea } from "@/components/ui/textarea";
import { STORE_SEO_DESCRIPTION_MAX, STORE_SEO_TITLE_MAX, counter, groupPatch, textOf } from "@/lib/store-settings-form";
import { Field, ImageUpload, SaveBar, TextField, useTabSave, type TabProps, type UploadedImage } from "./shared";

/** SEO and social: title and description with counters, a share image, social links, and a search and a share preview. */
export function SeoTab({ settings, save, onDirty }: TabProps) {
  const savedText = {
    title: textOf(settings.seo.title),
    description: textOf(settings.seo.description),
  };
  const savedSocial = {
    facebook: textOf(settings.social.facebook),
    instagram: textOf(settings.social.instagram),
    tiktok: textOf(settings.social.tiktok),
    whatsapp: textOf(settings.social.whatsapp),
  };
  const [seo, setSeo] = useState(savedText);
  const [social, setSocial] = useState(savedSocial);
  const [image, setImage] = useState<UploadedImage | null>(settings.seo.image);
  const form = useTabSave(save);

  useEffect(() => {
    setSeo(savedText);
    setSocial(savedSocial);
    setImage(settings.seo.image);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.updatedAt]);

  const seoPatch: Record<string, unknown> = { ...(groupPatch(savedText, seo) ?? {}) };
  if ((image?.id ?? null) !== (settings.seo.image?.id ?? null)) seoPatch.image = image?.id ?? null;
  const socialPatch = groupPatch(savedSocial, social);
  const dirty = Object.keys(seoPatch).length > 0 || socialPatch !== null;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const body: Record<string, unknown> = {};
    if (Object.keys(seoPatch).length > 0) body.seo = seoPatch;
    if (socialPatch) body.social = socialPatch;
    await form.run(body, "Saved.");
  }

  const err = (path: string) => form.fieldErrors[path];
  const shownTitle = seo.title.trim() || settings.profile.name;
  const shownDescription = seo.description.trim() || (settings.profile.description ?? "");
  const address = "https://" + settings.slug + ".markazify.com";
  const shareImage = image?.url ?? settings.branding.banner?.url ?? null;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <SectionCard title="Search and sharing" description="How your store looks in Google and when a link is shared.">
        <div className="flex flex-col gap-4">
          <TextField id="seoTitle" label="Page title" value={seo.title} onChange={(value) => setSeo({ ...seo, title: value })} error={err("seo.title")} counter={{ used: counter(seo.title, STORE_SEO_TITLE_MAX).used, max: STORE_SEO_TITLE_MAX }} hint="Leave empty to use the store name." />
          <Field id="seoDescription" label="Page description" error={err("seo.description")} counter={{ used: counter(seo.description, STORE_SEO_DESCRIPTION_MAX).used, max: STORE_SEO_DESCRIPTION_MAX }}>
            <Textarea id="seoDescription" rows={3} value={seo.description} onChange={(event) => setSeo({ ...seo, description: event.target.value })} aria-invalid={err("seo.description") !== undefined} />
          </Field>
          <ImageUpload label="Share image" value={image} onChange={setImage} alt={settings.profile.name + " share image"} shape="wide" error={err("seo.image")} />
        </div>
      </SectionCard>

      <SectionCard title="Previews" description="Roughly how it will look. Search engines decide the final result.">
        <div className="flex flex-col gap-5">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Search result</p>
            <div className="rounded-lg border p-3">
              <p className="truncate text-xs text-muted-foreground">{address}</p>
              <p className="truncate text-base font-medium text-primary">{shownTitle.slice(0, STORE_SEO_TITLE_MAX)}</p>
              <p className="line-clamp-2 text-sm text-muted-foreground">{shownDescription.slice(0, STORE_SEO_DESCRIPTION_MAX) || "No description yet."}</p>
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Shared link</p>
            <div className="max-w-sm overflow-hidden rounded-lg border">
              {shareImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shareImage} alt="" className="aspect-[1.91/1] w-full object-cover" />
              ) : (
                <div className="flex aspect-[1.91/1] w-full items-center justify-center bg-muted/40 text-sm text-muted-foreground">No image yet</div>
              )}
              <div className="p-3">
                <p className="truncate text-xs uppercase text-muted-foreground">{settings.slug}.markazify.com</p>
                <p className="truncate font-medium">{shownTitle}</p>
                <p className="line-clamp-2 text-sm text-muted-foreground">{shownDescription}</p>
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Social links" description="Full https links. They appear in your storefront footer.">
        <div className="flex flex-col gap-4">
          <TextField id="facebook" label="Facebook" type="url" placeholder="https://facebook.com/yourstore" value={social.facebook} onChange={(value) => setSocial({ ...social, facebook: value })} error={err("social.facebook")} />
          <TextField id="instagram" label="Instagram" type="url" placeholder="https://instagram.com/yourstore" value={social.instagram} onChange={(value) => setSocial({ ...social, instagram: value })} error={err("social.instagram")} />
          <TextField id="tiktok" label="TikTok" type="url" placeholder="https://tiktok.com/@yourstore" value={social.tiktok} onChange={(value) => setSocial({ ...social, tiktok: value })} error={err("social.tiktok")} />
          <TextField id="whatsappLink" label="WhatsApp link" type="url" placeholder="https://wa.me/923001234567" value={social.whatsapp} onChange={(value) => setSocial({ ...social, whatsapp: value })} error={err("social.whatsapp")} />
        </div>
      </SectionCard>

      <SaveBar dirty={dirty} busy={form.busy} feedback={form.feedback} />
    </form>
  );
}
