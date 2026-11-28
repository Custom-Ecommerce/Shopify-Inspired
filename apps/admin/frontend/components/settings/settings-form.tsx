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
  ADMIN_SETTINGS_GRACE_DAYS_MAX,
  ADMIN_SETTINGS_GRACE_DAYS_MIN,
  ADMIN_SETTINGS_MAX_STORES_MAX,
  ADMIN_SETTINGS_MAX_STORES_MIN,
  ADMIN_SETTINGS_NOTE_MAX,
  ADMIN_SETTINGS_PAYMENT_INSTRUCTIONS_MAX,
  ADMIN_SETTINGS_RATE_MAX,
  ADMIN_SETTINGS_RATE_MIN,
  ADMIN_SETTINGS_REASON_MAX,
  ADMIN_SETTINGS_REFERRAL_CAP_MAX,
  ADMIN_SETTINGS_REFERRAL_CAP_MIN,
  ADMIN_SETTINGS_REFERRAL_MONTHS_MAX,
  ADMIN_SETTINGS_REFERRAL_MONTHS_MIN,
  ADMIN_SETTINGS_SUPPORT_EMAIL_MAX,
  ADMIN_SETTINGS_SUPPORT_PHONE_MAX,
  ADMIN_SETTINGS_TRIAL_DAYS_MAX,
  ADMIN_SETTINGS_TRIAL_DAYS_MIN,
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
            <Label htmlFor="settings-rate">Default commission rate (gateway orders)</Label>
            <div className="relative w-40 max-w-full">
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
              A percentage from {ADMIN_SETTINGS_RATE_MIN} to {ADMIN_SETTINGS_RATE_MAX}. Applies to gateway (card) orders of every store that inherits the platform rate, not to cash on delivery. Sent to sellers.
            </p>
            <FieldError id="settings-rate-error" message={shown.defaultCommissionRate} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-cod-rate">Cash on delivery commission</Label>
            <div className="relative w-40 max-w-full">
              <Input
                id="settings-cod-rate"
                inputMode="decimal"
                autoComplete="off"
                maxLength={8}
                value={values.codCommissionPercent}
                aria-invalid={shown.codCommissionPercent !== undefined}
                aria-describedby={"settings-cod-rate-hint" + (shown.codCommissionPercent !== undefined ? " settings-cod-rate-error" : "")}
                className="pr-8 tabular-nums aria-[invalid=true]:border-destructive"
                onChange={(event) => change("codCommissionPercent", event.target.value)}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden>
                %
              </span>
            </div>
            <p id="settings-cod-rate-hint" className="text-xs text-muted-foreground">
              A percentage from {ADMIN_SETTINGS_RATE_MIN} to {ADMIN_SETTINGS_RATE_MAX}. 0 means cash on delivery orders carry no commission. A store&apos;s own rate never applies to them. Orders already recorded keep the percent they were recorded at. Sent to sellers.
            </p>
            <FieldError id="settings-cod-rate-error" message={shown.codCommissionPercent} />
          </div>

          <fieldset className="flex min-w-0 flex-col gap-5 rounded-xl border border-border p-4">
            <legend className="px-1 text-sm font-medium">Subscription plans</legend>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-payment-instructions">Payment instructions (optional)</Label>
              <Textarea
                id="settings-payment-instructions"
                rows={4}
                maxLength={ADMIN_SETTINGS_PAYMENT_INSTRUCTIONS_MAX}
                value={values.paymentInstructions}
                aria-invalid={shown.paymentInstructions !== undefined}
                aria-describedby={"settings-payment-instructions-hint" + (shown.paymentInstructions !== undefined ? " settings-payment-instructions-error" : "")}
                onChange={(event) => change("paymentInstructions", event.target.value)}
              />
              <p id="settings-payment-instructions-hint" className="text-xs text-muted-foreground">
                Shown to sellers who pay a subscription by bank transfer, JazzCash or Easypaisa. Plain text. Left blank, it is cleared. {values.paymentInstructions.length}/{ADMIN_SETTINGS_PAYMENT_INSTRUCTIONS_MAX}
              </p>
              <FieldError id="settings-payment-instructions-error" message={shown.paymentInstructions} />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="settings-grace-days">Grace period (days)</Label>
                <Input
                  id="settings-grace-days"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={2}
                  value={values.graceDays}
                  aria-invalid={shown.graceDays !== undefined}
                  aria-describedby={"settings-grace-days-hint" + (shown.graceDays !== undefined ? " settings-grace-days-error" : "")}
                  className="w-40 max-w-full tabular-nums aria-[invalid=true]:border-destructive"
                  onChange={(event) => change("graceDays", event.target.value)}
                />
                <p id="settings-grace-days-hint" className="text-xs text-muted-foreground">
                  Days a lapsed subscription keeps its plan limits: {ADMIN_SETTINGS_GRACE_DAYS_MIN} to {ADMIN_SETTINGS_GRACE_DAYS_MAX}. Sent to sellers.
                </p>
                <FieldError id="settings-grace-days-error" message={shown.graceDays} />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="settings-trial-days">Free trial (days)</Label>
                <Input
                  id="settings-trial-days"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={2}
                  value={values.trialDays}
                  aria-invalid={shown.trialDays !== undefined}
                  aria-describedby={"settings-trial-days-hint" + (shown.trialDays !== undefined ? " settings-trial-days-error" : "")}
                  className="w-40 max-w-full tabular-nums aria-[invalid=true]:border-destructive"
                  onChange={(event) => change("trialDays", event.target.value)}
                />
                <p id="settings-trial-days-hint" className="text-xs text-muted-foreground">
                  Days of a free trial on a paid plan: {ADMIN_SETTINGS_TRIAL_DAYS_MIN} to {ADMIN_SETTINGS_TRIAL_DAYS_MAX}. 0 means no trial. Sent to sellers.
                </p>
                <FieldError id="settings-trial-days-error" message={shown.trialDays} />
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="settings-support-email">Support email (optional)</Label>
                <Input
                  id="settings-support-email"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  maxLength={ADMIN_SETTINGS_SUPPORT_EMAIL_MAX}
                  value={values.supportEmail}
                  aria-invalid={shown.supportEmail !== undefined}
                  aria-describedby={shown.supportEmail !== undefined ? "settings-support-email-error" : undefined}
                  className="aria-[invalid=true]:border-destructive"
                  onChange={(event) => change("supportEmail", event.target.value)}
                />
                <FieldError id="settings-support-email-error" message={shown.supportEmail} />
              </div>

              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="settings-support-phone">Support phone (optional)</Label>
                <Input
                  id="settings-support-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  maxLength={ADMIN_SETTINGS_SUPPORT_PHONE_MAX}
                  value={values.supportPhone}
                  aria-invalid={shown.supportPhone !== undefined}
                  aria-describedby={shown.supportPhone !== undefined ? "settings-support-phone-error" : undefined}
                  className="aria-[invalid=true]:border-destructive"
                  onChange={(event) => change("supportPhone", event.target.value)}
                />
                <FieldError id="settings-support-phone-error" message={shown.supportPhone} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Where sellers can reach the platform about a subscription payment. Sent to sellers.</p>
          </fieldset>

          <fieldset className="flex min-w-0 flex-col gap-5 rounded-xl border border-border p-4">
            <legend className="px-1 text-sm font-medium">Referrals</legend>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="settings-referral-months">Reward (free months)</Label>
                <Input
                  id="settings-referral-months"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={2}
                  value={values.referralRewardMonths}
                  aria-invalid={shown.referralRewardMonths !== undefined}
                  aria-describedby={"settings-referral-months-hint" + (shown.referralRewardMonths !== undefined ? " settings-referral-months-error" : "")}
                  className="w-40 max-w-full tabular-nums aria-[invalid=true]:border-destructive"
                  onChange={(event) => change("referralRewardMonths", event.target.value)}
                />
                <p id="settings-referral-months-hint" className="text-xs text-muted-foreground">
                  Free months a referrer earns per referral: {ADMIN_SETTINGS_REFERRAL_MONTHS_MIN} to {ADMIN_SETTINGS_REFERRAL_MONTHS_MAX}. 0 turns referrals off: no new referrals are recorded. Sent to sellers.
                </p>
                <FieldError id="settings-referral-months-error" message={shown.referralRewardMonths} />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="settings-referral-cap">Monthly cap per referrer</Label>
                <Input
                  id="settings-referral-cap"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={3}
                  value={values.referralMonthlyCap}
                  aria-invalid={shown.referralMonthlyCap !== undefined}
                  aria-describedby={"settings-referral-cap-hint" + (shown.referralMonthlyCap !== undefined ? " settings-referral-cap-error" : "")}
                  className="w-40 max-w-full tabular-nums aria-[invalid=true]:border-destructive"
                  onChange={(event) => change("referralMonthlyCap", event.target.value)}
                />
                <p id="settings-referral-cap-hint" className="text-xs text-muted-foreground">
                  Most rewards one referrer can earn in a month: {ADMIN_SETTINGS_REFERRAL_CAP_MIN} to {ADMIN_SETTINGS_REFERRAL_CAP_MAX}. It also limits how many new referrals one referrer can get in a day. Sent to sellers.
                </p>
                <FieldError id="settings-referral-cap-error" message={shown.referralMonthlyCap} />
              </div>
            </div>
          </fieldset>

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

          <fieldset className="flex min-w-0 flex-col gap-5 rounded-xl border border-border p-4">
            <legend className="px-1 text-sm font-medium">Phone apps</legend>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="settings-min-seller-app">Oldest seller app served</Label>
                <Input
                  id="settings-min-seller-app"
                  inputMode="decimal"
                  autoComplete="off"
                  maxLength={32}
                  placeholder="1.0.0"
                  value={values.minSellerAppVersion}
                  aria-invalid={shown.minSellerAppVersion !== undefined}
                  aria-describedby={"settings-min-seller-app-hint" + (shown.minSellerAppVersion !== undefined ? " settings-min-seller-app-error" : "")}
                  className="w-40 max-w-full tabular-nums aria-[invalid=true]:border-destructive"
                  onChange={(event) => change("minSellerAppVersion", event.target.value)}
                />
                <p id="settings-min-seller-app-hint" className="text-xs text-muted-foreground">
                  An older seller app is told to update. Left blank, every version works.
                </p>
                <FieldError id="settings-min-seller-app-error" message={shown.minSellerAppVersion} />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="settings-min-admin-app">Oldest admin app served</Label>
                <Input
                  id="settings-min-admin-app"
                  inputMode="decimal"
                  autoComplete="off"
                  maxLength={32}
                  placeholder="1.0.0"
                  value={values.minAdminAppVersion}
                  aria-invalid={shown.minAdminAppVersion !== undefined}
                  aria-describedby={"settings-min-admin-app-hint" + (shown.minAdminAppVersion !== undefined ? " settings-min-admin-app-error" : "")}
                  className="w-40 max-w-full tabular-nums aria-[invalid=true]:border-destructive"
                  onChange={(event) => change("minAdminAppVersion", event.target.value)}
                />
                <p id="settings-min-admin-app-hint" className="text-xs text-muted-foreground">
                  An older admin app is told to update. Left blank, every version works.
                </p>
                <FieldError id="settings-min-admin-app-error" message={shown.minAdminAppVersion} />
              </div>
            </div>
          </fieldset>

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
