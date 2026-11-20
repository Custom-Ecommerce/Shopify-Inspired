"use client";

import { useEffect, useState } from "react";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EMAIL_FOOTER_MAX, MESSAGE_VARIABLES, WHATSAPP_TEMPLATE_MAX, unknownMessageVariables } from "@markaz/contracts/store-settings";
import { whatsappPreviewText } from "@markaz/notifications/whatsapp";
import { counter, groupPatch, textOf } from "@/lib/store-settings-form";
import { Field, SaveBar, useTabSave, type TabProps } from "./shared";

/**
 * Sprint 4 EP-07.US02.T02: the seller's own words. A WhatsApp text that replaces the platform text on the order page's
 * "Message customer on WhatsApp" button, and a footer added to the order emails. Plain text; the WhatsApp text may use only
 * the variables listed below, written {name}. Both have a live preview and a "reset to default" (an empty field).
 */
export function MessagesTab({ settings, save, onDirty }: TabProps) {
  const saved = { whatsappTemplate: textOf(settings.messages.whatsappTemplate), emailFooter: textOf(settings.messages.emailFooter) };
  const [values, setValues] = useState(saved);
  const form = useTabSave(save);

  useEffect(() => {
    setValues(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.updatedAt]);

  const patch = groupPatch(saved, values);
  const dirty = patch !== null;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const unknown = unknownMessageVariables(values.whatsappTemplate);
  const whatsappError =
    form.fieldErrors["messages.whatsappTemplate"] ??
    (unknown.length > 0 ? "Unknown variable {" + unknown[0] + "}. Use only the variables listed below." : undefined);
  const footerError = form.fieldErrors["messages.emailFooter"];

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (patch === null || unknown.length > 0) return;
    await form.run({ messages: patch }, "Saved.");
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <SectionCard title="WhatsApp message" description="Used for confirmed, dispatched and delivered orders. Empty: the platform text is used.">
        <div className="flex flex-col gap-4">
          <Field id="whatsappTemplate" label="Your message" error={whatsappError} counter={{ used: counter(values.whatsappTemplate, WHATSAPP_TEMPLATE_MAX).used, max: WHATSAPP_TEMPLATE_MAX }}>
            <Textarea
              id="whatsappTemplate"
              rows={4}
              value={values.whatsappTemplate}
              onChange={(event) => setValues({ ...values, whatsappTemplate: event.target.value })}
              aria-invalid={whatsappError !== undefined}
              placeholder="Hi {customerName}, your {storeName} order {orderNumber} is on its way. Track it: {trackingLink}"
            />
          </Field>
          <p className="text-xs text-muted-foreground">Variables: {MESSAGE_VARIABLES.map((name) => "{" + name + "}").join(", ")}</p>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Preview</p>
            <p className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 text-sm">{whatsappPreviewText(unknown.length > 0 ? null : values.whatsappTemplate, settings.profile.name)}</p>
          </div>
          <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto sm:self-start" onClick={() => setValues({ ...values, whatsappTemplate: "" })} disabled={values.whatsappTemplate === ""}>
            Reset to default
          </Button>
        </div>
      </SectionCard>

      <SectionCard title="Email footer" description="Added at the bottom of the order emails your customers receive. Empty: no footer.">
        <div className="flex flex-col gap-4">
          <Field id="emailFooter" label="Footer text" error={footerError} counter={{ used: counter(values.emailFooter, EMAIL_FOOTER_MAX).used, max: EMAIL_FOOTER_MAX }}>
            <Textarea
              id="emailFooter"
              rows={3}
              value={values.emailFooter}
              onChange={(event) => setValues({ ...values, emailFooter: event.target.value })}
              aria-invalid={footerError !== undefined}
              placeholder="Questions? WhatsApp us on 0300 1234567."
            />
          </Field>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Preview</p>
            <p className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">{values.emailFooter.trim() || "No footer."}</p>
          </div>
          <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto sm:self-start" onClick={() => setValues({ ...values, emailFooter: "" })} disabled={values.emailFooter === ""}>
            Reset to default
          </Button>
        </div>
      </SectionCard>

      <SaveBar dirty={dirty && unknown.length === 0} busy={form.busy} feedback={form.feedback} />
    </form>
  );
}
