"use client";

import { useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MODE_COPY, TAX_LABEL_MAX, TAX_NOTE, formFromTax, isTaxDirty, taxBody, taxExample, taxProblems, type TaxForm } from "@/lib/tax-view";
import { Field, SaveBar, TextField, useTabSave, type TabProps } from "./shared";

/**
 * Sprint 8 (S8-B1, D-118): the Tax tab. OFF by default. One rate, 0 to 100 with up to 2 decimals, either added on top of the prices (exclusive) or already
 * inside them (inclusive), under a name the seller chooses. PKR only; delivery is never taxed. Saved through the grouped PATCH ({ tax: {...} }); the owner
 * and a manager may change it.
 */
export function TaxTab({ settings, save, onDirty }: TabProps) {
  const saved = useMemo(() => formFromTax(settings.tax), [settings.tax]);
  const [form, setForm] = useState<TaxForm>(saved);
  const run = useTabSave(save);

  useEffect(() => {
    setForm(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.updatedAt]);

  const dirty = isTaxDirty(saved, form);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const example = taxExample(form);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const problems = taxProblems(form);
    if (Object.keys(problems).length > 0) {
      run.setFieldErrors(problems);
      return;
    }
    const body = taxBody(saved, form);
    if (body === null) return;
    await run.run(body, "Tax settings saved.");
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <SectionCard title="Tax" description="Add tax to your orders. It is off until you turn it on, and it applies to the items after any discount, never to delivery.">
        <div className="flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="taxEnabled" className="text-sm font-medium">
                Charge tax on orders
              </Label>
              <p className="text-sm text-muted-foreground">Amounts are in Pakistani rupees, rounded to a whole rupee once for the whole order.</p>
            </div>
            <Switch id="taxEnabled" checked={form.enabled} onCheckedChange={(on) => setForm({ ...form, enabled: on })} aria-label="Charge tax on orders" />
          </div>

          <TextField
            id="taxRate"
            label="Tax rate (%)"
            inputMode="decimal"
            value={form.rate}
            onChange={(value) => setForm({ ...form, rate: value })}
            error={run.fieldErrors["tax.ratePercent"]}
            hint="From 0 to 100, up to 2 decimals. For example 17 or 17.5."
          />

          <Field id="taxMode" label="How the tax is applied" error={run.fieldErrors["tax.mode"]} hint={MODE_COPY[form.mode].help}>
            <select
              id="taxMode"
              className="h-11 rounded-lg border bg-background px-3 text-sm"
              value={form.mode}
              onChange={(event) => setForm({ ...form, mode: event.target.value === "inclusive" ? "inclusive" : "exclusive" })}
            >
              <option value="exclusive">{MODE_COPY.exclusive.name}</option>
              <option value="inclusive">{MODE_COPY.inclusive.name}</option>
            </select>
          </Field>

          <TextField
            id="taxLabel"
            label="Name shown to shoppers"
            value={form.label}
            onChange={(value) => setForm({ ...form, label: value })}
            error={run.fieldErrors["tax.label"]}
            counter={{ used: form.label.trim().length, max: TAX_LABEL_MAX }}
            hint="For example Tax or GST. An inclusive tax is shown as “Tax (included)”."
          />

          {example ? <p className="rounded-lg bg-muted/50 p-3 text-sm">{example}</p> : null}
          <p className="text-sm text-muted-foreground">{TAX_NOTE}</p>
          <SaveBar dirty={dirty} busy={run.busy} feedback={run.feedback} />
        </div>
      </SectionCard>
    </form>
  );
}
