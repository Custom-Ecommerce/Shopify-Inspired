"use client";

import type { DashboardOrderDetail, DashboardOrderTimelineEntry, OrderCancelResponse, OrderStockRestore } from "@markaz/contracts";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { storeHref } from "@/lib/store-routes";
import { formatRs as money } from "@/lib/format";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/dashboard/shared/EmptyState";
import { ErrorState } from "@/components/dashboard/shared/ErrorState";
import {
  ORDER_STATUS_LABEL,
  OrderStatusBadge,
  PAYMENT_METHOD_LABEL,
  PaymentStatusBadge,
} from "@/components/dashboard/shared/StatusBadge";

// EP-02 OB-1b: the order detail, read only. Data comes from GET /api/dashboard/orders/:id (proxy to the seller backend's
// GET /api/orders/:id), in the DashboardOrderDetail shape.

type LoadState =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "error" }
  | { kind: "ready"; order: DashboardOrderDetail };

/** One button per allowed next status (OB-2). The flow itself comes from the API's allowedNext, never from here. */
const ACTION_LABEL: Record<string, string> = {
  confirmed: "Confirm order",
  processing: "Start processing",
  dispatched: "Mark as dispatched",
  delivered: "Mark as delivered",
};

/** Moves that ask first. Dispatch has its own courier form (OB-4). */
const CONFIRM_COPY: Record<string, { title: string; description: string }> = {
  delivered: {
    title: "Mark this order as delivered?",
    description: "Do this once the customer has received the parcel. This is the last step of the order.",
  },
};

interface ActionError {
  message: string;
  /** The move to try again, for errors that are worth retrying as they are. */
  retry: string | null;
}

const dateTime = (iso: string): string =>
  new Date(iso).toLocaleString("en-PK", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Karachi",
  });

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right">{children}</span>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading order">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-5 w-64" />
      <Skeleton className="h-40 w-full rounded-2xl" />
      <Skeleton className="h-32 w-full rounded-2xl" />
    </div>
  );
}

// EP-02 OB-4: courier and tracking. The list matches COURIERS in @markaz/contracts (types-only import here); "Other" lets
// the seller type any courier name. The limits match the transition and tracking request schemas.
const COURIER_OPTIONS = ["TCS", "Leopards", "M&P", "Trax", "PostEx", "BlueEx", "Call Courier", "Pakistan Post", "Other"] as const;
const OTHER_COURIER = "Other";
const COURIER_MIN = 2;
const COURIER_MAX = 40;
const TRACKING_MAX = 60;
const URL_MAX = 500;
const NOTE_MAX = 500;
const HTTP_URL = /^https?:\/\//i;

type TrackingFieldName = "courier" | "trackingNumber" | "trackingUrl" | "note";
type FieldErrors = Partial<Record<TrackingFieldName, string>>;

interface CourierFormValues {
  choice: string;
  otherName: string;
  trackingNumber: string;
  trackingUrl: string;
}

function courierFormFrom(order: DashboardOrderDetail | null): CourierFormValues {
  const courier = order?.courier ?? "";
  const known = (COURIER_OPTIONS as readonly string[]).includes(courier) && courier !== OTHER_COURIER;
  return {
    choice: courier === "" ? COURIER_OPTIONS[0] : known ? courier : OTHER_COURIER,
    otherName: courier !== "" && !known ? courier : "",
    trackingNumber: order?.trackingNumber ?? "",
    trackingUrl: order?.trackingUrl ?? "",
  };
}

const courierOf = (values: CourierFormValues): string => (values.choice === OTHER_COURIER ? values.otherName.trim() : values.choice);

/** The same rules the server applies, checked first so the seller sees them next to the field. */
function checkCourierForm(values: CourierFormValues): FieldErrors {
  const errors: FieldErrors = {};
  const courier = courierOf(values);
  if (courier.length < COURIER_MIN || courier.length > COURIER_MAX) errors.courier = `Enter the courier name (${COURIER_MIN} to ${COURIER_MAX} characters).`;
  const tracking = values.trackingNumber.trim();
  if (tracking.length < 1 || tracking.length > TRACKING_MAX) errors.trackingNumber = `Enter the tracking number (up to ${TRACKING_MAX} characters).`;
  const url = values.trackingUrl.trim();
  if (url !== "" && (!HTTP_URL.test(url) || url.length > URL_MAX)) errors.trackingUrl = "The tracking link must start with http:// or https://.";
  return errors;
}

/** The field a 400 names (the proxy keeps the backend's errors in details), with its message. */
async function readFieldError(res: Response): Promise<{ field: TrackingFieldName | null; message: string }> {
  const data = (await res.json().catch(() => null)) as { error?: string; details?: Array<{ field?: string | null; message?: string }> } | null;
  const first = Array.isArray(data?.details) ? data?.details[0] : undefined;
  const field = first?.field;
  const known = field === "courier" || field === "trackingNumber" || field === "trackingUrl" || field === "note";
  return { field: known ? field : null, message: first?.message ?? data?.error ?? "Check the details and try again." };
}

const FIELD_CLASS = "h-11 w-full rounded-md border border-input bg-transparent px-2 text-sm sm:h-9";

function FieldError({ message }: { message?: string }) {
  return message ? <span className="text-xs text-destructive">{message}</span> : null;
}

/** Courier select (with "Other" text), tracking number and tracking link. Shared by the dispatch and edit dialogs. */
function CourierFields({
  values,
  errors,
  disabled,
  onChange,
}: {
  values: CourierFormValues;
  errors: FieldErrors;
  disabled: boolean;
  onChange: (next: CourierFormValues) => void;
}) {
  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Courier</span>
        <select
          value={values.choice}
          onChange={(event) => onChange({ ...values, choice: event.target.value })}
          disabled={disabled}
          className={FIELD_CLASS}
          aria-invalid={errors.courier ? true : undefined}
        >
          {COURIER_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      {values.choice === OTHER_COURIER ? (
        <label className="flex flex-col gap-1">
          <span className="font-medium">Courier name</span>
          <input
            value={values.otherName}
            onChange={(event) => onChange({ ...values, otherName: event.target.value })}
            maxLength={COURIER_MAX}
            disabled={disabled}
            className={FIELD_CLASS}
            aria-invalid={errors.courier ? true : undefined}
          />
        </label>
      ) : null}
      <FieldError message={errors.courier} />
      <label className="flex flex-col gap-1">
        <span className="font-medium">Tracking number</span>
        <input
          value={values.trackingNumber}
          onChange={(event) => onChange({ ...values, trackingNumber: event.target.value })}
          maxLength={TRACKING_MAX}
          disabled={disabled}
          required
          className={`${FIELD_CLASS} font-mono`}
          aria-invalid={errors.trackingNumber ? true : undefined}
        />
        <FieldError message={errors.trackingNumber} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">
          Tracking link <span className="font-normal text-muted-foreground">(optional)</span>
        </span>
        <input
          type="url"
          inputMode="url"
          value={values.trackingUrl}
          onChange={(event) => onChange({ ...values, trackingUrl: event.target.value })}
          maxLength={URL_MAX}
          placeholder="https://"
          disabled={disabled}
          className={FIELD_CLASS}
          aria-invalid={errors.trackingUrl ? true : undefined}
        />
        <FieldError message={errors.trackingUrl} />
      </label>
    </>
  );
}

/** The dispatch form (OB-4): courier, tracking number, optional link and note, sent through the transition proxy. */
function DispatchDialog({
  order,
  open,
  onOpenChange,
  onDone,
  onConflict,
}: {
  order: DashboardOrderDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => Promise<void>;
  onConflict: () => Promise<void>;
}) {
  const storeFetch = useStoreFetch();
  const [values, setValues] = useState<CourierFormValues>(() => courierFormFrom(null));
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValues(courierFormFrom(order));
    setNote("");
    setErrors({});
    setFailure(null);
  }, [open, order]);

  async function submit(): Promise<void> {
    const found = checkCourierForm(values);
    if (note.trim().length > NOTE_MAX) found.note = `The note can be at most ${NOTE_MAX} characters.`;
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSubmitting(true);
    setFailure(null);
    try {
      const url = values.trackingUrl.trim();
      const res = await storeFetch(`/api/dashboard/orders/${order.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "dispatched",
          courier: courierOf(values),
          trackingNumber: values.trackingNumber.trim(),
          ...(url ? { trackingUrl: url } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      if (res.ok) {
        onOpenChange(false);
        await onDone();
        return;
      }
      if (res.status === 400) {
        const { field, message } = await readFieldError(res);
        if (field) setErrors({ [field]: message });
        else setFailure(message);
        return;
      }
      if (res.status === 409 || res.status === 422) {
        onOpenChange(false);
        await onConflict();
        return;
      }
      setFailure("Could not save the dispatch. Check your connection and try again.");
    } catch {
      setFailure("Could not save the dispatch. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => (!next && !submitting ? onOpenChange(false) : undefined)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Mark as dispatched</AlertDialogTitle>
          <AlertDialogDescription>Do this once the parcel has left with the courier. The order cannot go back to processing.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex min-w-0 flex-col gap-3 text-sm">
          <CourierFields values={values} errors={errors} disabled={submitting} onChange={setValues} />
          <label className="flex flex-col gap-1">
            <span className="font-medium">
              Note <span className="font-normal text-muted-foreground">(optional, for your team)</span>
            </span>
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={NOTE_MAX} disabled={submitting} />
            <FieldError message={errors.note} />
          </label>
          {failure ? (
            <p role="alert" className="text-destructive">
              {failure}
            </p>
          ) : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 w-full sm:h-9 sm:w-auto" disabled={submitting}>
            Not yet
          </AlertDialogCancel>
          <AlertDialogAction className="h-11 w-full sm:h-9 sm:w-auto" disabled={submitting} onClick={() => void submit()}>
            {submitting ? "Saving…" : "Mark as dispatched"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** "Edit tracking" on a dispatched order (OB-4). Sends only what changed; clearing the link sends null. */
function EditTrackingDialog({
  order,
  onDone,
  onConflict,
}: {
  order: DashboardOrderDetail;
  onDone: () => Promise<void>;
  onConflict: () => Promise<void>;
}) {
  const storeFetch = useStoreFetch();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<CourierFormValues>(() => courierFormFrom(order));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function openDialog(): void {
    setValues(courierFormFrom(order));
    setErrors({});
    setFailure(null);
    setOpen(true);
  }

  async function submit(): Promise<void> {
    const found = checkCourierForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const changes: Record<string, string | null> = {};
    const courier = courierOf(values);
    const tracking = values.trackingNumber.trim();
    const url = values.trackingUrl.trim();
    if (courier !== (order.courier ?? "")) changes.courier = courier;
    if (tracking !== (order.trackingNumber ?? "")) changes.trackingNumber = tracking;
    if (url !== (order.trackingUrl ?? "")) changes.trackingUrl = url === "" ? null : url;
    if (Object.keys(changes).length === 0) {
      setOpen(false);
      return;
    }

    setSubmitting(true);
    setFailure(null);
    try {
      const res = await storeFetch(`/api/dashboard/orders/${order.id}/tracking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      if (res.ok) {
        setOpen(false);
        await onDone();
        return;
      }
      if (res.status === 400) {
        const { field, message } = await readFieldError(res);
        if (field) setErrors({ [field]: message });
        else setFailure(message);
        return;
      }
      if (res.status === 409 || res.status === 422) {
        setOpen(false);
        await onConflict();
        return;
      }
      setFailure("Could not save the tracking. Check your connection and try again.");
    } catch {
      setFailure("Could not save the tracking. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => (!next && !submitting ? setOpen(false) : undefined)}>
      <Button variant="clay-soft" className="h-11 w-full sm:h-9 sm:w-auto" onClick={openDialog}>
        Edit tracking
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Edit tracking</AlertDialogTitle>
          <AlertDialogDescription>The change is saved in the order history.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex min-w-0 flex-col gap-3 text-sm">
          <CourierFields values={values} errors={errors} disabled={submitting} onChange={setValues} />
          {failure ? (
            <p role="alert" className="text-destructive">
              {failure}
            </p>
          ) : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 w-full sm:h-9 sm:w-auto" disabled={submitting}>
            Close
          </AlertDialogCancel>
          <AlertDialogAction className="h-11 w-full sm:h-9 sm:w-auto" disabled={submitting} onClick={() => void submit()}>
            {submitting ? "Saving…" : "Save tracking"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// EP-02 OB-3: cancel. The suggested reasons match ORDER_CANCEL_REASON_OPTIONS in @markaz/contracts (the frontend imports
// contracts as types only); "Other" asks for the seller's own words. The request takes one reason string, 3 to 200 chars.
const CANCEL_REASONS = ["Customer asked to cancel", "Customer unreachable", "Out of stock", "Wrong or fake order"] as const;
const OTHER_REASON = "Other";
const CANCEL_REASON_MIN = 3;
const CANCEL_REASON_MAX = 200;

const SKIP_WORDS: Record<string, string> = {
  product_deleted: "product deleted",
  variant_deleted: "variant deleted",
};

const itemName = (item: { productTitle: string; variantTitle: string }): string =>
  item.variantTitle && item.variantTitle !== "Default" ? `${item.productTitle} (${item.variantTitle})` : item.productTitle;

/** A short plain-words notice of what happened to the stock after a cancel. */
function stockNoticeText(result: OrderStockRestore): string {
  const parts = ["Order cancelled."];
  if (result.restored.length > 0) {
    parts.push("Back in stock: " + result.restored.map((line) => `${line.qty} × ${line.name}`).join(", ") + ".");
  }
  const notReturned = result.skipped.filter((line) => SKIP_WORDS[line.why]).map((line) => `${line.name} (${SKIP_WORDS[line.why]})`);
  if (notReturned.length > 0) parts.push("Not returned: " + notReturned.join(", ") + ".");
  if (result.failed.length > 0) {
    parts.push("Could not return: " + result.failed.map((line) => line.name).join(", ") + ". Adjust it on the Inventory page.");
  }
  return parts.join(" ");
}

/**
 * The "Cancel order" button and its dialog. The dialog lists what will go back to stock: lines whose stock was taken at
 * placement (stockDeducted true), and for older orders (no flag) the lines that may go back if they track stock. Lines that
 * took nothing are not listed.
 */
function CancelOrderDialog({
  order,
  disabled,
  onCancelled,
  onConflict,
}: {
  order: DashboardOrderDetail;
  disabled: boolean;
  onCancelled: (result: OrderStockRestore) => Promise<void>;
  onConflict: () => Promise<void>;
}) {
  const storeFetch = useStoreFetch();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string>(CANCEL_REASONS[0]);
  const [otherText, setOtherText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reason = choice === OTHER_REASON ? otherText.trim() : choice;
  const reasonValid = reason.length >= CANCEL_REASON_MIN && reason.length <= CANCEL_REASON_MAX;
  const returning = order.items.filter((item) => item.stockDeducted === true);
  const maybeReturning = order.items.filter((item) => item.stockDeducted === null);

  function openDialog(): void {
    setChoice(CANCEL_REASONS[0]);
    setOtherText("");
    setError(null);
    setOpen(true);
  }

  async function submit(): Promise<void> {
    if (!reasonValid) {
      setError(`Write a reason of ${CANCEL_REASON_MIN} to ${CANCEL_REASON_MAX} characters.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await storeFetch(`/api/dashboard/orders/${order.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as OrderCancelResponse | null;
        setOpen(false);
        await onCancelled(data?.stockRestore ?? { restored: [], skipped: [], failed: [] });
        return;
      }
      if (res.status === 409 || res.status === 422) {
        setOpen(false);
        await onConflict();
        return;
      }
      setError("Could not cancel the order. Check your connection and try again.");
    } catch {
      setError("Could not cancel the order. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => (!next && !submitting ? setOpen(false) : undefined)}>
      <Button variant="destructive" className="h-11 w-full sm:w-auto" disabled={disabled || submitting} onClick={openDialog}>
        Cancel order
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel order {order.orderId}?</AlertDialogTitle>
          <AlertDialogDescription>A cancelled order cannot be reopened.</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex min-w-0 flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="font-medium">Reason</span>
            <select
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              disabled={submitting}
              className="h-11 w-full rounded-md border border-input bg-transparent px-2 text-sm sm:h-9"
            >
              {[...CANCEL_REASONS, OTHER_REASON].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          {choice === OTHER_REASON ? (
            <label className="flex flex-col gap-1">
              <span className="font-medium">Your reason</span>
              <Textarea
                value={otherText}
                onChange={(event) => setOtherText(event.target.value)}
                maxLength={CANCEL_REASON_MAX}
                disabled={submitting}
                required
                placeholder="Why is this order cancelled?"
              />
            </label>
          ) : null}

          {returning.length > 0 || maybeReturning.length > 0 ? (
            <div className="flex flex-col gap-1">
              <span className="font-medium">Stock</span>
              <ul className="flex flex-col gap-0.5 text-muted-foreground">
                {returning.map((item, i) => (
                  <li key={"r" + i} className="break-words">
                    {item.quantity} × {itemName(item)} will go back to stock
                  </li>
                ))}
                {maybeReturning.map((item, i) => (
                  <li key={"m" + i} className="break-words">
                    {item.quantity} × {itemName(item)} will go back to stock if it tracks quantity
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 w-full sm:h-9 sm:w-auto" disabled={submitting}>
            Keep order
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            className="h-11 w-full sm:h-9 sm:w-auto"
            disabled={submitting || !reasonValid}
            onClick={() => void submit()}
          >
            {submitting ? "Cancelling…" : "Cancel order"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// EP-02 OB-5a: COD collected, internal notes and the timeline.

const ORDER_CHANGED_MESSAGE = "This order was changed by someone else or in another tab, so it was not marked collected. It has been refreshed; check its status.";

/** "Mark COD collected": asks first, showing the amount. The server checks the amount against the order total. */
function MarkCollectedDialog({
  order,
  onDone,
  onConflict,
}: {
  order: DashboardOrderDetail;
  onDone: () => Promise<void>;
  onConflict: () => Promise<void>;
}) {
  const storeFetch = useStoreFetch();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const res = await storeFetch(`/api/dashboard/orders/${order.id}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The amount the seller just confirmed. A free order has nothing to send: amount must be above 0.
        body: JSON.stringify(order.total > 0 ? { amount: order.total } : {}),
      });
      if (res.ok) {
        setOpen(false);
        await onDone();
        return;
      }
      if (res.status === 409 || res.status === 422) {
        setOpen(false);
        await onConflict();
        return;
      }
      setError("Could not save this. Check your connection and try again.");
    } catch {
      setError("Could not save this. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => (!next && !submitting ? setOpen(false) : undefined)}>
      <Button
        variant="clay"
        className="h-11 w-full sm:h-9 sm:w-auto"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        Mark COD collected
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Collected {money(order.total)} in cash from the customer?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 w-full sm:h-9 sm:w-auto" disabled={submitting}>
            Not yet
          </AlertDialogCancel>
          <AlertDialogAction className="h-11 w-full sm:h-9 sm:w-auto" disabled={submitting} onClick={() => void submit()}>
            {submitting ? "Saving…" : "Yes, collected"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const NOTE_TEXT_MAX = 500;

/** The internal note box. Cleared on success; the page then reads the order again. */
function AddNoteBox({ orderId, onAdded }: { orderId: string; onAdded: () => Promise<void> }) {
  const storeFetch = useStoreFetch();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = text.trim();

  async function submit(): Promise<void> {
    if (trimmed === "") return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await storeFetch(`/api/dashboard/orders/${orderId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      if (res.ok) {
        setText("");
        await onAdded();
        return;
      }
      const data = (await res.json().catch(() => null)) as { code?: string } | null;
      setError(
        data?.code === "ORDER_NOTES_FULL"
          ? "This order already has the maximum of 100 notes."
          : "Could not save the note. Check your connection and try again.",
      );
    } catch {
      setError("Could not save the note. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="font-medium">
          Add note <span className="font-normal text-muted-foreground">(internal, the customer never sees it)</span>
        </span>
        <Textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={NOTE_TEXT_MAX} disabled={submitting} />
      </label>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs tabular-nums text-muted-foreground">
          {text.length} / {NOTE_TEXT_MAX}
        </span>
        <Button variant="clay-soft" className="h-11 w-full sm:h-9 sm:w-auto" disabled={trimmed === "" || submitting} onClick={() => void submit()}>
          {submitting ? "Saving…" : "Add note"}
        </Button>
      </div>
    </div>
  );
}

const TIMELINE_DOT: Record<DashboardOrderTimelineEntry["kind"], string> = {
  placed: "bg-muted-foreground",
  status: "bg-primary",
  tracking: "bg-info",
  payment: "bg-success",
  stock: "bg-warning",
  note: "bg-foreground/40",
};

/** Newest first, from the API's timeline: the order placed, every status and tracking change, payment, stock and notes. */
function OrderTimeline({ entries }: { entries: DashboardOrderTimelineEntry[] }) {
  return (
    <ol className="flex flex-col gap-3 border-t pt-4">
      {entries.map((entry) => (
        <li key={entry.id} className="flex min-w-0 items-start gap-2.5">
          <span className={`mt-1.5 size-2 shrink-0 rounded-full ${TIMELINE_DOT[entry.kind]}`} aria-hidden="true" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-medium">{entry.title}</span>
              {entry.kind === "note" ? (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Internal</span>
              ) : null}
            </span>
            {entry.detail ? <span className="whitespace-pre-wrap break-words text-muted-foreground">{entry.detail}</span> : null}
            <span className="text-xs text-muted-foreground">{dateTime(entry.at)}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function OrderDetailPage() {
  const storeFetch = useStoreFetch();
  const params = useParams<{ storeId: string; id: string }>();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [running, setRunning] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const [stockNotice, setStockNotice] = useState<string | null>(null);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);
  const [confirmNote, setConfirmNote] = useState("");

  /** Reads the order. A quiet refresh (after an action) keeps the page on screen instead of showing the skeleton. */
  const fetchOrder = useCallback(
    async (quiet: boolean): Promise<void> => {
      if (!quiet) setState({ kind: "loading" });
      try {
        const res = await storeFetch(`/api/dashboard/orders/${params.id}`);
        if (res.status === 404) return setState({ kind: "not_found" });
        const data = (await res.json().catch(() => null)) as DashboardOrderDetail | null;
        if (!res.ok || !data?.id) {
          if (!quiet) setState({ kind: "error" });
          return;
        }
        setState({ kind: "ready", order: data });
      } catch {
        if (!quiet) setState({ kind: "error" });
      }
    },
    [params.id, storeFetch],
  );

  const load = useCallback(() => {
    setActionError(null);
    setStockNotice(null);
    setPaymentMessage(null);
    void fetchOrder(false);
  }, [fetchOrder]);

  /** After a cancel: show what happened to the stock, then read the order again (quietly). */
  async function handleCancelled(result: OrderStockRestore): Promise<void> {
    setActionError(null);
    setStockNotice(stockNoticeText(result));
    await fetchOrder(true);
  }

  /** 409 or 422 from cancel: the order moved on (or was already cancelled) elsewhere. */
  async function handleCancelConflict(): Promise<void> {
    setStockNotice(null);
    setActionError({
      message: "This order was changed by someone else or in another tab, so it was not cancelled. It has been refreshed; check its status.",
      retry: null,
    });
    await fetchOrder(true);
  }

  useEffect(load, [load]);

  /** Sends one move, then always reads the order again from the server (no optimistic update). */
  async function runTransition(target: string, note?: string): Promise<void> {
    setRunning(target);
    setActionError(null);
    try {
      const res = await storeFetch(`/api/dashboard/orders/${params.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: target, ...(note && note.trim() ? { note: note.trim().slice(0, NOTE_MAX) } : {}) }),
      });
      if (res.status === 409 || res.status === 422) {
        setActionError({
          message: "This order was changed by someone else or in another tab. It has been refreshed, so check its status and try again.",
          retry: null,
        });
      } else if (!res.ok) {
        setActionError({ message: "Could not save this change. Check your connection and try again.", retry: target });
      }
      await fetchOrder(true);
    } catch {
      setActionError({ message: "Could not save this change. Check your connection and try again.", retry: target });
    } finally {
      setRunning(null);
      setConfirming(null);
    }
  }

  function startTransition(target: string): void {
    if (target === "dispatched") {
      setDispatchOpen(true);
      return;
    }
    if (CONFIRM_COPY[target]) {
      setConfirmNote("");
      setConfirming(target);
    } else void runTransition(target);
  }

  /** After a dispatch or a tracking edit: read the order again quietly. */
  async function handleSaved(): Promise<void> {
    setActionError(null);
    await fetchOrder(true);
  }

  /** 409 or 422 from the dispatch or the tracking edit: the order moved on elsewhere. */
  async function handleChangedElsewhere(): Promise<void> {
    setActionError({
      message: "This order was changed by someone else or in another tab, so nothing was saved. It has been refreshed; check its status.",
      retry: null,
    });
    await fetchOrder(true);
  }

  const backLink = (
    <Link href={storeHref(params.storeId, "/orders")} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
      ← All orders
    </Link>
  );

  if (state.kind === "loading") {
    return (
      <div className="flex max-w-3xl flex-col gap-4 p-4 sm:p-8">
        {backLink}
        <DetailSkeleton />
      </div>
    );
  }
  if (state.kind === "not_found") {
    return (
      <div className="flex max-w-3xl flex-col gap-4 p-4 sm:p-8">
        {backLink}
        <EmptyState title="Order not found" description="This order does not exist in this store." />
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="flex max-w-3xl flex-col gap-4 p-4 sm:p-8">
        {backLink}
        <ErrorState message="Could not load this order." onRetry={load} />
      </div>
    );
  }

  const { order } = state;

  return (
    <div className="flex min-w-0 max-w-3xl flex-col gap-6 p-4 sm:p-8">
      {backLink}

      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="break-all font-heading text-2xl font-bold">{order.orderId}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <OrderStatusBadge status={order.status} />
          <PaymentStatusBadge status={order.paymentStatus} />
          <span className="text-sm text-muted-foreground">Placed {dateTime(order.createdAt)}</span>
        </div>
      </div>

      {/* Actions: one button per allowedNext entry from the API, plus Cancel while canCancel (OB-3). Notes, payment and
          print arrive in OB-4 and OB-5. */}
      <section aria-label="Order actions" data-slot="order-actions" className="flex flex-col gap-3 empty:hidden">
        {stockNotice ? (
          <p role="status" className="rounded-xl border bg-muted/40 p-3 text-sm">
            {stockNotice}
          </p>
        ) : null}

        {order.allowedNext.length > 0 || order.canCancel ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {order.allowedNext.map((target) => (
              <Button
                key={target}
                variant="clay"
                className="h-11 w-full sm:w-auto"
                disabled={running !== null}
                onClick={() => startTransition(target)}
              >
                {running === target ? "Saving…" : ACTION_LABEL[target] ?? ORDER_STATUS_LABEL[target] ?? target}
              </Button>
            ))}
            {order.canCancel ? (
              <CancelOrderDialog
                order={order}
                disabled={running !== null}
                onCancelled={handleCancelled}
                onConflict={handleCancelConflict}
              />
            ) : null}
          </div>
        ) : order.status === "delivered" ? (
          <p className="text-sm text-muted-foreground">No further steps. This order is delivered.</p>
        ) : null}

        {order.status !== "cancelled" && order.status !== "returned" ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              variant="clay-soft"
              className="h-11 w-full sm:h-9 sm:w-auto"
              render={<a href={storeHref(params.storeId, `/orders/print?ids=${order.id}&mode=label`)} target="_blank" rel="noopener" />}
            >
              Print label
            </Button>
            <Button
              variant="clay-soft"
              className="h-11 w-full sm:h-9 sm:w-auto"
              render={<a href={storeHref(params.storeId, `/orders/print?ids=${order.id}&mode=slip`)} target="_blank" rel="noopener" />}
            >
              Print packing slip
            </Button>
          </div>
        ) : null}

        {actionError ? (
          <div role="alert" className="flex flex-col gap-2 rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span>{actionError.message}</span>
            {actionError.retry ? (
              <Button
                variant="clay-soft"
                className="h-11 w-full sm:h-9 sm:w-auto"
                disabled={running !== null}
                onClick={() => actionError.retry && void runTransition(actionError.retry)}
              >
                Try again
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => (!open && running === null ? setConfirming(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirming ? CONFIRM_COPY[confirming]?.title : ""}</AlertDialogTitle>
            <AlertDialogDescription>{confirming ? CONFIRM_COPY[confirming]?.description : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">
              Note <span className="font-normal text-muted-foreground">(optional, for your team)</span>
            </span>
            <Textarea value={confirmNote} onChange={(event) => setConfirmNote(event.target.value)} maxLength={NOTE_MAX} disabled={running !== null} />
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 w-full sm:h-9 sm:w-auto" disabled={running !== null}>
              Not yet
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 w-full sm:h-9 sm:w-auto"
              disabled={running !== null}
              onClick={() => confirming && void runTransition(confirming, confirmNote)}
            >
              {running !== null ? "Saving…" : confirming ? ACTION_LABEL[confirming] : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DispatchDialog
        order={order}
        open={dispatchOpen}
        onOpenChange={setDispatchOpen}
        onDone={handleSaved}
        onConflict={handleChangedElsewhere}
      />

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <ul className="flex flex-col divide-y">
            {order.items.map((item, i) => (
              <li key={i} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2 first:pt-0">
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-medium">{item.productTitle}</span>
                  <span className="block break-words text-xs text-muted-foreground">
                    {item.variantTitle !== "Default" ? item.variantTitle : null}
                    {item.variantTitle !== "Default" && item.sku ? " · " : null}
                    {item.sku ? `SKU ${item.sku}` : null}
                  </span>
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {money(item.unitPrice)} × {item.quantity}
                  </span>
                </span>
                <span className="tabular-nums font-medium">{money(item.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-1 border-t pt-3">
            <Row label="Subtotal">
              <span className="tabular-nums">{money(order.subtotal)}</span>
            </Row>
            <Row label="Delivery">
              <span className="tabular-nums">{order.deliveryCharges === 0 ? "Free" : money(order.deliveryCharges)}</span>
            </Row>
            {order.discountAmount > 0 ? (
              <Row label={order.discountCode ? "Discount (" + order.discountCode + ")" : "Discount"}>
                <span className="tabular-nums">-{money(order.discountAmount)}</span>
              </Row>
            ) : null}
            <Row label="Total">
              <span className="tabular-nums font-semibold">{money(order.total)}</span>
            </Row>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Customer</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          <p className="break-words font-medium">{order.customerName ?? "—"}</p>
          {order.phone ? <p className="font-mono">{order.phone}</p> : null}
          {order.address ? <p className="break-words">{order.address}</p> : null}
          {order.city ? <p>{order.city}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <Row label="Method">{order.paymentMethod ? PAYMENT_METHOD_LABEL[order.paymentMethod] : "—"}</Row>
          <Row label="Status">
            <PaymentStatusBadge status={order.paymentStatus} />
          </Row>
          {order.collectedAt ? <Row label="Collected">{dateTime(order.collectedAt)}</Row> : null}
          {order.collectedAmount !== null ? (
            <Row label="Amount collected">
              <span className="tabular-nums">{money(order.collectedAmount)}</span>
            </Row>
          ) : null}
          {paymentMessage ? (
            <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/8 p-3">
              {paymentMessage}
            </p>
          ) : null}
          {order.canMarkCollected ? (
            <div className="pt-1">
              <MarkCollectedDialog
                order={order}
                onDone={async () => {
                  setPaymentMessage(null);
                  await fetchOrder(true);
                }}
                onConflict={async () => {
                  setPaymentMessage(ORDER_CHANGED_MESSAGE);
                  await fetchOrder(true);
                }}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {order.courier || order.trackingNumber || order.trackingUrl || order.canEditTracking ? (
        <Card>
          <CardHeader>
            <CardTitle>Courier and tracking</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {order.canEditTracking && !order.courier && !order.trackingNumber ? (
              <p className="text-muted-foreground">No courier or tracking number saved yet.</p>
            ) : null}
            {order.courier ? <Row label="Courier">{order.courier}</Row> : null}
            {order.trackingNumber ? (
              <Row label="Tracking number">
                <span className="break-all font-mono">{order.trackingNumber}</span>
              </Row>
            ) : null}
            {order.trackingUrl ? (
              <Row label="Tracking link">
                <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline-offset-4 hover:underline">
                  Open tracking page
                </a>
              </Row>
            ) : null}
            {order.canEditTracking ? (
              <div className="pt-1">
                <EditTrackingDialog order={order} onDone={handleSaved} onConflict={handleChangedElsewhere} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {order.status === "cancelled" && (order.cancelledAt || order.cancelReason) ? (
        <Card>
          <CardHeader>
            <CardTitle>Cancellation</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {order.cancelledAt ? <Row label="Cancelled">{dateTime(order.cancelledAt)}</Row> : null}
            {order.cancelReason ? <Row label="Reason">{order.cancelReason}</Row> : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <AddNoteBox orderId={order.id} onAdded={() => fetchOrder(true)} />
          <OrderTimeline entries={order.timeline} />
        </CardContent>
      </Card>
    </div>
  );
}
