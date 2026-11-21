"use client";

import { useEffect, useState } from "react";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { returnWindowProblem } from "@/lib/returns-view";
import { SaveBar, TextField, useTabSave, type TabProps } from "./shared";

/**
 * Sprint 5 EP-13.US01.T02 (D-107): the Returns tab. How many days after delivery a shopper may ask for a return (0 to 30, default 7; 0 means the
 * store takes no returns). The window counts from the day the order was marked delivered. Saved through the grouped PATCH ({ returns: { returnWindowDays } }).
 */
export function ReturnsTab({ settings, save, onDirty }: TabProps) {
  const saved = String(settings.returns.returnWindowDays);
  const [days, setDays] = useState(saved);
  const form = useTabSave(save);

  useEffect(() => {
    setDays(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.updatedAt]);

  const dirty = days.trim() !== saved;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const problem = returnWindowProblem(days);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (problem !== null) {
      form.setFieldErrors({ "returns.returnWindowDays": problem });
      return;
    }
    await form.run({ returns: { returnWindowDays: Number(days.trim()) } }, "Return window saved.");
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <SectionCard title="Return window" description="How long after delivery a customer can ask to return items. Customers ask from their order page.">
        <div className="flex flex-col gap-4">
          <TextField
            id="returnWindowDays"
            label="Days after delivery"
            inputMode="numeric"
            value={days}
            onChange={setDays}
            error={form.fieldErrors["returns.returnWindowDays"]}
            hint="0 to 30. Use 0 if you do not take returns."
          />
          <SaveBar dirty={dirty} busy={form.busy} feedback={form.feedback} />
        </div>
      </SectionCard>
    </form>
  );
}
