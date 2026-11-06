const DATE_TIME = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });
const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "-" : DATE_TIME.format(date);
}

/** Localised relative time such as "3 days ago". Under a minute it is "just now". */
export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return RELATIVE.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

/** Commission is a percentage everywhere (ID-18): 7.5 is shown as 7.5%. */
export function formatPercent(value: number): string {
  return Number.isInteger(value) ? value + "%" : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "") + "%";
}

export function shortId(id: string): string {
  return id.length > 8 ? id.slice(-8) : id;
}

const MONEY = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Money is stored in minor units (ID-18): 123450 is shown as 1,234.50 rupees. A negative amount is a refund reversal. */
export function formatMoney(minorUnits: number): string {
  return Number.isFinite(minorUnits) ? MONEY.format(minorUnits / 100) : "-";
}
