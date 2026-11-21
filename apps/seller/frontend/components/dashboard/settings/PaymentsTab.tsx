"use client";

import { useEffect, useState } from "react";
import { SectionCard } from "@/components/dashboard/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CARD_CHECKOUT_UNSUPPORTED_MESSAGE } from "@markaz/contracts/store-settings";
import { lastPaymentMethod, payoutProblem } from "@/lib/store-settings-form";
import { Field, SaveBar, TextField, useTabSave, type TabProps } from "./shared";

const METHODS = [
  { value: "bank", label: "Bank account" },
  { value: "jazzcash", label: "JazzCash" },
  { value: "easypaisa", label: "Easypaisa" },
] as const;

type Method = (typeof METHODS)[number]["value"];

function PaymentSwitches({ settings, save, onDirty }: TabProps) {
  const saved = { codEnabled: settings.payments.codEnabled, cardEnabled: settings.payments.cardEnabled };
  const [draft, setDraft] = useState(saved);
  const [notice, setNotice] = useState<string | null>(null);
  const form = useTabSave(save);
  // SB-11 (V-06): on a theme whose checkout has no card option, cash on delivery cannot be switched off (the server refuses it too).
  // Sprint 5 EP-11.US04 (D-107): COD-only mode. While the platform has card checkout off, cash on delivery is the only way to pay,
  // so it cannot be switched off, and the card switch and the Stripe wording are not shown at all.
  const cardAvailable = settings.payments.cardAvailable;
  const codLocked = draft.codEnabled && (!cardAvailable || !settings.theme.supportsCardCheckout);

  useEffect(() => {
    setDraft(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.updatedAt]);

  const dirty = draft.codEnabled !== saved.codEnabled || draft.cardEnabled !== saved.cardEnabled;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  function toggle(which: "codEnabled" | "cardEnabled", on: boolean) {
    if (!on && lastPaymentMethod(draft, which)) {
      setNotice("Keep at least one payment method on, or shoppers cannot check out.");
      return;
    }
    setNotice(null);
    setDraft({ ...draft, [which]: on });
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    await form.run({ payments: { codEnabled: draft.codEnabled, cardEnabled: draft.cardEnabled } }, "Payment methods saved.");
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <SectionCard title="Payment methods" description={cardAvailable ? "What shoppers can choose at checkout." : "Shoppers pay cash on delivery. You confirm each order by phone or WhatsApp before you dispatch it."}>
        <div className="flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="cod">Cash on delivery</Label>
              <p className="text-sm text-muted-foreground">The shopper pays the courier when the parcel arrives. You keep the cash.</p>
              {codLocked ? (
                <p id="cod-reason" className="mt-1 text-sm text-muted-foreground">
                  {cardAvailable ? CARD_CHECKOUT_UNSUPPORTED_MESSAGE : "Cash on delivery is the only payment method for now, so it stays on."}
                </p>
              ) : null}
              {!cardAvailable && !draft.codEnabled ? (
                <p role="alert" className="mt-1 text-sm text-destructive">
                  Shoppers cannot check out while cash on delivery is off. Switch it on and save.
                </p>
              ) : null}
            </div>
            <Switch
              id="cod"
              checked={draft.codEnabled}
              disabled={codLocked}
              onCheckedChange={(on) => toggle("codEnabled", on)}
              aria-label="Cash on delivery"
              aria-describedby={codLocked ? "cod-reason" : undefined}
            />
          </div>
          {cardAvailable ? (
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor="card">Card payments</Label>
                <p className="text-sm text-muted-foreground">Card money is collected by Markazify and paid out to you after our commission.</p>
              </div>
              <Switch id="card" checked={draft.cardEnabled} onCheckedChange={(on) => toggle("cardEnabled", on)} aria-label="Card payments" />
            </div>
          ) : null}
          {notice ? (
            <p role="alert" className="text-sm text-destructive">
              {notice}
            </p>
          ) : null}
          <SaveBar dirty={dirty} busy={form.busy} feedback={form.feedback} />
        </div>
      </SectionCard>
    </form>
  );
}

function PayoutForm({ settings, save, onDirty }: TabProps) {
  const payout = settings.payout;
  const [editing, setEditing] = useState(payout === null);
  const [method, setMethod] = useState<Method>(payout?.method ?? "bank");
  const [accountTitle, setAccountTitle] = useState(payout?.accountTitle ?? "");
  const [accountNumber, setAccountNumber] = useState("");
  const [confirmNumber, setConfirmNumber] = useState("");
  const [bankName, setBankName] = useState(payout?.bankName ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  const form = useTabSave(save);

  const dirty = editing && (accountNumber !== "" || confirmNumber !== "" || accountTitle !== (payout?.accountTitle ?? "") || bankName !== (payout?.bankName ?? "") || method !== (payout?.method ?? "bank"));
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const problem = payoutProblem({ method, accountTitle, accountNumber, confirmNumber, bankName });
    setLocalError(problem);
    if (problem) return;
    const saved = await form.run({ payout: { method, accountTitle, accountNumber, bankName: method === "bank" ? bankName : "" } }, "Payout details saved.");
    if (saved) {
      // Never keep the full number after a save: only the masked form comes back from the server.
      setAccountNumber("");
      setConfirmNumber("");
      setEditing(false);
    }
  }

  return (
    <SectionCard title="Where we pay you" description="Card payments and your earnings are paid to this account. Only the last 4 digits are ever shown again.">
      {!editing && payout ? (
        <div className="flex flex-col gap-4">
          <dl className="grid gap-1 text-sm">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Method</dt>
              <dd className="font-medium">{METHODS.find((m) => m.value === payout.method)?.label ?? payout.method}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Account title</dt>
              <dd className="break-words font-medium">{payout.accountTitle}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Account number</dt>
              <dd className="font-mono font-medium">{payout.accountNumberMasked}</dd>
            </div>
            {payout.bankName ? (
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Bank</dt>
                <dd className="font-medium">{payout.bankName}</dd>
              </div>
            ) : null}
          </dl>
          {form.feedback ? <p className="text-sm text-muted-foreground">{form.feedback.text}</p> : null}
          <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => setEditing(true)}>
            Change payout details
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Method</legend>
            <div className="flex flex-wrap gap-2">
              {METHODS.map((option) => (
                <label key={option.value} className={"inline-flex min-h-11 cursor-pointer items-center rounded-lg border px-3 text-sm " + (method === option.value ? "border-primary bg-primary/10 font-medium" : "")}>
                  <input type="radio" name="payoutMethod" className="sr-only" checked={method === option.value} onChange={() => setMethod(option.value)} />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
          <TextField id="accountTitle" label="Account title" value={accountTitle} onChange={setAccountTitle} error={form.fieldErrors["payout.accountTitle"]} autoComplete="off" />
          {method === "bank" ? <TextField id="bankName" label="Bank name" value={bankName} onChange={setBankName} error={form.fieldErrors["payout.bankName"]} autoComplete="off" /> : null}
          <TextField
            id="accountNumber"
            label={method === "bank" ? "IBAN or account number" : "Mobile account number"}
            value={accountNumber}
            onChange={setAccountNumber}
            error={form.fieldErrors["payout.accountNumber"]}
            inputMode={method === "bank" ? "text" : "numeric"}
            autoComplete="off"
            hint={payout ? "Enter the full number again. We only keep it for payouts." : undefined}
          />
          <Field id="confirmNumber" label="Enter the number again" error={localError ?? undefined}>
            <input
              id="confirmNumber"
              className="h-11 rounded-lg border bg-background px-3 text-sm"
              value={confirmNumber}
              onChange={(event) => setConfirmNumber(event.target.value)}
              autoComplete="off"
              onPaste={(event) => event.preventDefault()}
              aria-invalid={localError !== null}
            />
          </Field>
          <SaveBar dirty={dirty} busy={form.busy} feedback={form.feedback} label="Save payout details" />
          {payout ? (
            <Button type="button" variant="ghost" className="min-h-11 w-full sm:w-auto" onClick={() => { setEditing(false); setAccountNumber(""); setConfirmNumber(""); setLocalError(null); }}>
              Cancel
            </Button>
          ) : null}
        </form>
      )}
    </SectionCard>
  );
}

/** Payments: the two switches (the last one cannot be turned off) and the payout details with a masked display and a re-enter step. */
export function PaymentsTab(props: TabProps) {
  // The two forms report separately; the page only needs to know if either has unsaved edits.
  const [switchesDirty, setSwitchesDirty] = useState(false);
  const [payoutDirty, setPayoutDirty] = useState(false);
  const { onDirty } = props;
  useEffect(() => onDirty(switchesDirty || payoutDirty), [switchesDirty, payoutDirty, onDirty]);
  return (
    <div className="flex flex-col gap-6">
      <PaymentSwitches {...props} onDirty={setSwitchesDirty} />
      <PayoutForm {...props} onDirty={setPayoutDirty} />
    </div>
  );
}
