"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useActiveStoreId } from "@/lib/dashboard-context";
import { MODE_COPY, riskRulesBody } from "@/lib/fraud-view";
import { isDirty, searchCities } from "@/lib/store-settings-form";
import { storeHref } from "@/lib/store-routes";
import { Field, SaveBar, TextField, useTabSave, type TabProps } from "./shared";

type Mode = (typeof MODE_COPY)[number]["value"];

const CITIES_MAX = 30;

/**
 * Sprint 5 EP-11.US01.T01 and US03.T03 (D-107): the Fraud tab. How the store confirms cash on delivery orders by phone (off, flagged
 * orders only, every order), the three rules that flag an order, and the link to the blocklist. A flag never rejects an order: it only
 * makes it wait for the seller's call. Saved through the grouped PATCH ({ fraud: { codConfirmation, riskRules } }).
 */
export function FraudTab({ settings, save, onDirty }: TabProps) {
  const storeId = useActiveStoreId();
  const fraud = settings.fraud;
  const saved = {
    mode: fraud.codConfirmation as Mode,
    orderValue: fraud.riskRules.flagOrderValueAbove === null ? "" : String(fraud.riskRules.flagOrderValueAbove),
    returns: fraud.riskRules.flagReturnsAtLeast === null ? "" : String(fraud.riskRules.flagReturnsAtLeast),
    cities: [...fraud.riskRules.flaggedCities],
  };
  const [draft, setDraft] = useState(saved);
  const [query, setQuery] = useState("");
  const form = useTabSave(save);

  useEffect(() => {
    setDraft(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.updatedAt]);

  const dirty = isDirty(saved, draft);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const matches = useMemo(() => (query.trim() === "" ? [] : searchCities(query, 6, draft.cities)), [query, draft.cities]);
  const err = (path: string) => form.fieldErrors[path];

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const rules = riskRulesBody({ orderValue: draft.orderValue, returns: draft.returns, cities: draft.cities });
    if (rules.body === null) {
      form.setFieldErrors(rules.errors);
      return;
    }
    await form.run({ fraud: { codConfirmation: draft.mode, riskRules: rules.body } }, "Fraud settings saved.");
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <SectionCard title="Phone confirmation" description="Cash on delivery orders can wait for your call or WhatsApp message before you dispatch them. Card orders never wait.">
        <fieldset className="grid gap-2">
          <legend className="sr-only">Confirmation mode</legend>
          {MODE_COPY.map((option) => (
            <label
              key={option.value}
              className={"flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm " + (draft.mode === option.value ? "border-primary bg-primary/10" : "")}
            >
              <input type="radio" name="codConfirmation" className="mt-1" checked={draft.mode === option.value} onChange={() => setDraft({ ...draft, mode: option.value })} />
              <span className="min-w-0">
                <span className="block font-medium">{option.label}</span>
                <span className="block text-muted-foreground">{option.description}</span>
              </span>
            </label>
          ))}
          {err("fraud.codConfirmation") ? <p className="text-sm text-destructive">{err("fraud.codConfirmation")}</p> : null}
        </fieldset>
      </SectionCard>

      <SectionCard
        title="Risk rules"
        description={
          draft.mode === "off"
            ? "Turn on phone confirmation above for these rules to apply. They only flag an order; they never refuse it."
            : "An order that matches a rule is flagged. In 'flagged orders only' mode a flagged order waits for your call. A rule never refuses an order."
        }
      >
        <div className="flex flex-col gap-4">
          <TextField
            id="flagOrderValueAbove"
            label="Flag orders above (Rs.)"
            inputMode="numeric"
            value={draft.orderValue}
            onChange={(value) => setDraft({ ...draft, orderValue: value })}
            error={err("fraud.riskRules.flagOrderValueAbove")}
            hint="Whole rupees. Leave empty for no limit."
          />

          <Field id="flagReturnsAtLeast" label="Flag customers with at least this many returns" error={err("fraud.riskRules.flagReturnsAtLeast")} hint="Counts start once returns are in use. Leave on Off for no rule.">
            <select
              id="flagReturnsAtLeast"
              className="h-11 rounded-lg border bg-background px-3 text-sm"
              value={draft.returns}
              onChange={(event) => setDraft({ ...draft, returns: event.target.value })}
            >
              <option value="">Off</option>
              {Array.from({ length: 10 }, (_, index) => index + 1).map((count) => (
                <option key={count} value={String(count)}>
                  {count} {count === 1 ? "return" : "returns"}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid gap-1.5">
            <Label htmlFor="flaggedCitySearch">Flag orders to these cities</Label>
            <Input
              id="flaggedCitySearch"
              className="h-11"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Start typing, for example Kara"
              autoComplete="off"
              disabled={draft.cities.length >= CITIES_MAX}
            />
            {query.trim() !== "" ? (
              matches.length > 0 ? (
                <ul className="flex flex-wrap gap-2" aria-label="Matching cities">
                  {matches.map((city) => (
                    <li key={city}>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11"
                        onClick={() => {
                          setDraft({ ...draft, cities: [...draft.cities, city] });
                          setQuery("");
                        }}
                      >
                        {city}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No city in the list matches. Check the spelling.</p>
              )
            ) : null}
            <p className="text-xs text-muted-foreground">
              {draft.cities.length} of {CITIES_MAX} cities.
            </p>
            {err("fraud.riskRules.flaggedCities") ? <p className="text-sm text-destructive">{err("fraud.riskRules.flaggedCities")}</p> : null}
            {draft.cities.length > 0 ? (
              <ul className="flex flex-wrap gap-2" aria-label="Flagged cities">
                {draft.cities.map((city) => (
                  <li key={city} className="inline-flex min-h-11 items-center gap-1 rounded-full border bg-muted/40 pl-3 text-sm">
                    {city}
                    <Button type="button" variant="ghost" className="min-h-11 min-w-11" aria-label={"Remove " + city} onClick={() => setDraft({ ...draft, cities: draft.cities.filter((entry) => entry !== city) })}>
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">A customer with no earlier order from the same phone number is always flagged as a new customer.</p>
        </div>
      </SectionCard>

      <SectionCard title="Blocklist" description="A blocked phone or email cannot place an order. The shopper sees a neutral message and is told to contact the store.">
        <Link href={storeHref(storeId, "/blocklist")} className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border bg-background px-4 text-sm font-semibold hover:bg-muted sm:w-auto">
          Manage blocklist
        </Link>
      </SectionCard>

      <SaveBar dirty={dirty} busy={form.busy} feedback={form.feedback} />
    </form>
  );
}
