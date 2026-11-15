"use client";

import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRs } from "@/lib/format";
import { groupPatch, parseRupees, quotePreview, searchCities, textOf } from "@/lib/store-settings-form";
import { Field, SaveBar, TextField, useTabSave, type TabProps } from "./shared";

interface CityRow {
  city: string;
  rate: string;
}

const OTHER_CITY = "";

/** Delivery: default rate, free-over amount, rates per city (searched in the shared city list), estimate, and a quote preview. */
export function DeliveryTab({ settings, save, onDirty }: TabProps) {
  const d = settings.delivery;
  const savedBase = { defaultRate: String(d.defaultRate), freeOver: d.freeOver === null ? "" : String(d.freeOver), estimate: textOf(d.estimate) };
  const savedRows: CityRow[] = d.cityRates.map((row) => ({ city: row.city, rate: String(row.rate) }));
  const [base, setBase] = useState(savedBase);
  const [rows, setRows] = useState<CityRow[]>(savedRows);
  const [query, setQuery] = useState("");
  const [sampleCity, setSampleCity] = useState(OTHER_CITY);
  const [sampleTotal, setSampleTotal] = useState("3000");
  const form = useTabSave(save);

  useEffect(() => {
    setBase(savedBase);
    setRows(savedRows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.updatedAt]);

  const baseDirty = groupPatch(savedBase, base) !== null;
  const rowsDirty = JSON.stringify(rows) !== JSON.stringify(savedRows);
  const dirty = baseDirty || rowsDirty;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const matches = useMemo(() => (query.trim() === "" ? [] : searchCities(query, 6, rows.map((row) => row.city))), [query, rows]);

  const rate = parseRupees(base.defaultRate);
  const freeOver = parseRupees(base.freeOver);
  const total = parseRupees(sampleTotal);
  const rowRates = rows.map((row) => parseRupees(row.rate));
  const previewable = rate !== null && !Number.isNaN(rate) && !Number.isNaN(freeOver) && total !== null && !Number.isNaN(total) && rowRates.every((value) => value !== null && !Number.isNaN(value));
  const quote = previewable
    ? quotePreview({ defaultRate: rate, freeOver, cityRates: rows.map((row, index) => ({ city: row.city, rate: rowRates[index] as number })) }, sampleCity === OTHER_CITY ? null : sampleCity, total)
    : null;

  function addCity(city: string) {
    setRows((current) => [...current, { city, rate: base.defaultRate }]);
    setQuery("");
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (rate === null || Number.isNaN(rate)) errors["delivery.defaultRate"] = "Enter the delivery rate in whole rupees. Use 0 for free delivery.";
    if (Number.isNaN(freeOver)) errors["delivery.freeOver"] = "Enter a whole number of rupees, or leave it empty.";
    rowRates.forEach((value, index) => {
      if (value === null || Number.isNaN(value)) errors["delivery.cityRates." + index + ".rate"] = "Enter the rate in whole rupees.";
    });
    if (Object.keys(errors).length > 0) {
      form.setFieldErrors(errors);
      return;
    }
    await form.run(
      {
        delivery: {
          defaultRate: rate,
          freeOver,
          cityRates: rows.map((row, index) => ({ city: row.city, rate: rowRates[index] })),
          estimate: base.estimate,
        },
      },
      "Delivery settings saved.",
    );
  }

  const err = (path: string) => form.fieldErrors[path];

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <SectionCard title="Delivery rates" description="Whole rupees. A city rate replaces the default rate for that city.">
        <div className="flex flex-col gap-4">
          <TextField id="defaultRate" label="Default delivery rate (Rs.)" inputMode="numeric" value={base.defaultRate} onChange={(value) => setBase({ ...base, defaultRate: value })} error={err("delivery.defaultRate")} hint="Use 0 for free delivery everywhere." />
          <TextField id="freeOver" label="Free delivery over (Rs.)" inputMode="numeric" value={base.freeOver} onChange={(value) => setBase({ ...base, freeOver: value })} error={err("delivery.freeOver")} hint="Delivery is free when the items, after any discount, reach this amount. Leave empty for no offer." />
          <TextField id="estimate" label="Estimated delivery time" placeholder="2 to 4 days" value={base.estimate} onChange={(value) => setBase({ ...base, estimate: value })} error={err("delivery.estimate")} maxLength={80} hint="Shown to shoppers at checkout." />
        </div>
      </SectionCard>

      <SectionCard title="Rates by city" description="Search the list and add a city that needs its own rate.">
        <div className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="citySearch">Add a city</Label>
            <Input id="citySearch" className="h-11" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Start typing, for example Kara" autoComplete="off" />
            {query.trim() !== "" ? (
              matches.length > 0 ? (
                <ul className="flex flex-wrap gap-2" aria-label="Matching cities">
                  {matches.map((city) => (
                    <li key={city}>
                      <Button type="button" variant="outline" className="min-h-11" onClick={() => addCity(city)}>
                        {city}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No city in the list matches. Check the spelling.</p>
              )
            ) : null}
            {err("delivery.cityRates") ? <p className="text-sm text-destructive">{err("delivery.cityRates")}</p> : null}
          </div>

          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No city has its own rate. Every city pays the default rate.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {rows.map((row, index) => (
                <li key={row.city} className="grid grid-cols-[1fr_auto] items-end gap-2 sm:grid-cols-[1fr_9rem_auto]">
                  <div className="col-span-2 sm:col-span-1">
                    <p className="text-sm font-medium">{row.city}</p>
                    {err("delivery.cityRates." + index + ".city") ? <p className="text-sm text-destructive">{err("delivery.cityRates." + index + ".city")}</p> : null}
                  </div>
                  <Field id={"rate-" + index} label="Rate (Rs.)" error={err("delivery.cityRates." + index + ".rate")}>
                    <Input id={"rate-" + index} className="h-11" inputMode="numeric" value={row.rate} onChange={(event) => setRows((current) => current.map((r, i) => (i === index ? { ...r, rate: event.target.value } : r)))} />
                  </Field>
                  <Button type="button" variant="ghost" className="min-h-11" aria-label={"Remove " + row.city} onClick={() => setRows((current) => current.filter((_, i) => i !== index))}>
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Preview a quote" description="What a shopper pays for delivery, using these settings (not yet saved) and the same rule checkout uses.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="sampleCity">Shipping city</Label>
            <select id="sampleCity" className="h-11 rounded-lg border bg-background px-3 text-sm" value={sampleCity} onChange={(event) => setSampleCity(event.target.value)}>
              <option value={OTHER_CITY}>Any other city</option>
              {rows.map((row) => (
                <option key={row.city} value={row.city}>
                  {row.city}
                </option>
              ))}
            </select>
          </div>
          <TextField id="sampleTotal" label="Items in the cart (Rs.)" inputMode="numeric" value={sampleTotal} onChange={setSampleTotal} />
        </div>
        <p className="mt-4 text-sm" role="status" aria-live="polite">
          {quote === null ? (
            <span className="text-muted-foreground">Fix the amounts above to see a quote.</span>
          ) : quote.free ? (
            <span className="font-medium">Delivery is free for this cart.</span>
          ) : (
            <span>
              Delivery: <span className="font-medium">{formatRs(quote.charge)}</span>
              {quote.rate !== Number(rate) ? " (city rate)" : ""}
            </span>
          )}
        </p>
      </SectionCard>

      <SaveBar dirty={dirty} busy={form.busy} feedback={form.feedback} />
    </form>
  );
}
