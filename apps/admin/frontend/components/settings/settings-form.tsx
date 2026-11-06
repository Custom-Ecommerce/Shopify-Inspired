"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateSettings } from "@/lib/api/client";
import {
  ADMIN_SETTINGS_MAX_STORES_MAX,
  ADMIN_SETTINGS_MAX_STORES_MIN,
  ADMIN_SETTINGS_NOTE_MAX,
  ADMIN_SETTINGS_RATE_MAX,
  ADMIN_SETTINGS_RATE_MIN,
  ADMIN_SETTINGS_REASON_MAX,
  type AdminPlatformSettings,
  type AdminSettingsUpdateRequest,
} from "@/lib/contracts";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useAdminMutation } from "@/lib/hooks/use-admin-mutation";
import {
  changedSettingFields,
  formFromSettings,
  issuesToErrors,
  toUpdateRequest,
  validateSettingsForm,
  type SettingsFormErrors,
  type SettingsFormField,
  type SettingsFormValues,
} from "@/lib/settings";

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

/**
 * The editable platform settings. The form starts from the settings as loaded and sends only what the operator changed,
 * with a mandatory reason. The console confirms the write with the server before it shows the new values (no optimistic
 * update). A 409 means someone else changed the settings: the message is shown with a reload button.
 */
export function SettingsForm({ settings, onReload }: { settings: AdminPlatformSettings; onReload: () => void }) {
  const [saved, setSaved] = useState<AdminPlatformSettings>(settings);
  const [values, setValues] = useState<SettingsFormValues>(formFromSettings(settings));
  const [errors, setErrors] = useState<SettingsFormErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const mutation = useAdminMutation((input: AdminSettingsUpdateRequest) => updateSettings(input));

  const serverError = mutation.error;
  const serverFields: SettingsFormErrors = serverError ? issuesToErrors(serverError.issues) : {};
  const shown: SettingsFormErrors = { ...serverFields };
  for (const [field, message] of Object.entries(errors)) {
    if (message) shown[field as SettingsFormField] = message;
  }
  const generalError = serverError && Object.keys(serverFields).length === 0 ? serverError.message : null;
  const conflict = serverError !== null && serverError.status === 409;
  const dirty = changedSettingFields(values, saved).length > 0 || values.reason !== "";

  function change(field: SettingsFormField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setNotice(null);
    mutation.reset();
  }

  function discard() {
    setValues(formFromSettings(saved));
    setErrors({});
    setNotice(null);
    mutation.reset();
  }

  function reload() {
    mutation.reset();
    onReload();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    if (changedSettingFields(values, saved).length === 0) {
      setErrors({});
      setNotice("Nothing has changed.");
      return;
    }
    const problems = validateSettingsForm(values);
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;

    const result = await mutation.run(toUpdateRequest(values, saved));
    if (result === null) return;
    setSaved(result.settings);
    setValues(formFromSettings(result.settings));
    toast.success("Settings saved", { description: result.queued ? "Sent to sellers." : "Recorded in the audit log." });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Platform settings</CardTitle>
        <CardDescription>
          Revision <span className="tabular-nums">{saved.settingsRevision}</span>
          {" · "}
          {saved.updatedAt ? (
            <>
              last changed <time dateTime={saved.updatedAt} title={formatDateTime(saved.updatedAt)}>{formatRelative(saved.updatedAt)}</time>
            </>
          ) : (
            "never changed from its initial values"
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate aria-label="Platform settings" className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-rate">Default commission rate</Label>
            <div className="relative w-40">
              <Input
                id="settings-rate"
                inputMode="decimal"
                autoComplete="off"
                maxLength={8}
                value={values.defaultCommissionRate}
                aria-invalid={shown.defaultCommissionRate !== undefined}
                aria-describedby={"settings-rate-hint" + (shown.defaultCommissionRate !== undefined ? " settings-rate-error" : "")}
                className="pr-8 tabular-nums aria-[invalid=true]:border-destructive"
                onChange={(event) => change("defaultCommissionRate", event.target.value)}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden>
                %
              </span>
            </div>
            <p id="settings-rate-hint" className="text-xs text-muted-foreground">
              A percentage from {ADMIN_SETTINGS_RATE_MIN} to {ADMIN_SETTINGS_RATE_MAX}. Applies to every store that inherits the platform rate. Sent to sellers.
            </p>
            <FieldError id="settings-rate-error" message={shown.defaultCommissionRate} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-max-stores">Stores per seller</Label>
            <Input
              id="settings-max-stores"
              inputMode="numeric"
              autoComplete="off"
              maxLength={String(ADMIN_SETTINGS_MAX_STORES_MAX).length}
              value={values.maxStoresPerSeller}
              aria-invalid={shown.maxStoresPerSeller !== undefined}
              aria-describedby={"settings-max-stores-hint" + (shown.maxStoresPerSeller !== undefined ? " settings-max-stores-error" : "")}
              className="w-40 tabular-nums aria-[invalid=true]:border-destructive"
              onChange={(event) => change("maxStoresPerSeller", event.target.value)}
            />
            <p id="settings-max-stores-hint" className="text-xs text-muted-foreground">
              The most stores one seller may own: a whole number from {ADMIN_SETTINGS_MAX_STORES_MIN} to {ADMIN_SETTINGS_MAX_STORES_MAX}. Sent to sellers.
            </p>
            <FieldError id="settings-max-stores-error" message={shown.maxStoresPerSeller} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-note">Stripe commission note (optional)</Label>
            <Textarea
              id="settings-note"
              rows={3}
              maxLength={ADMIN_SETTINGS_NOTE_MAX}
              value={values.stripeCommissionNote}
              aria-invalid={shown.stripeCommissionNote !== undefined}
              aria-describedby={"settings-note-hint" + (shown.stripeCommissionNote !== undefined ? " settings-note-error" : "")}
              onChange={(event) => change("stripeCommissionNote", event.target.value)}
            />
            <p id="settings-note-hint" className="text-xs text-muted-foreground">
              An internal note about Stripe fees. Not sent to sellers. Left blank, it is cleared. {values.stripeCommissionNote.length}/{ADMIN_SETTINGS_NOTE_MAX}
            </p>
            <FieldError id="settings-note-error" message={shown.stripeCommissionNote} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-reason">Reason for the change (required)</Label>
            <Textarea
              id="settings-reason"
              rows={2}
              maxLength={ADMIN_SETTINGS_REASON_MAX}
              value={values.reason}
              aria-invalid={shown.reason !== undefined}
              aria-describedby={shown.reason !== undefined ? "settings-reason-error" : undefined}
              onChange={(event) => change("reason", event.target.value)}
            />
            <FieldError id="settings-reason-error" message={shown.reason} />
          </div>

          {notice !== null ? (
            <p role="status" className="text-sm text-muted-foreground">
              {notice}
            </p>
          ) : null}
          {generalError !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {generalError}
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            {conflict ? (
              <Button variant="outline" onClick={reload} disabled={mutation.pending}>
                Reload settings
              </Button>
            ) : null}
            <Button variant="ghost" onClick={discard} disabled={mutation.pending || !dirty}>
              Discard changes
            </Button>
            <Button type="submit" disabled={mutation.pending}>
              {mutation.pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Save settings
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
