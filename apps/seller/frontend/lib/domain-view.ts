/**
 * S7-B5 (D-118): the custom domain page. Pure: what the page reads from the backend, and the plain words it shows. Short English that
 * is easy to follow for a seller who is new to DNS (and to translate).
 */

export type DomainStatus = "unset" | "pending" | "verified" | "failed";

export interface DnsRecord {
  type: "CNAME" | "A" | "TXT";
  name: string;
  value: string;
}

export interface DomainState {
  domain: string | null;
  status: DomainStatus;
  dnsRecords: DnsRecord[];
  failureReason: string | null;
  failureMessage: string | null;
  checkedAt: string | null;
  vercelConfigured: boolean;
  planAllowsCustomDomain: boolean;
  /** S7-B6: the "redirect the platform address to my domain" setting. */
  redirectToCustomDomain: boolean;
}

const STATUSES: readonly string[] = ["unset", "pending", "verified", "failed"];
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads the answer of /api/proxy/domain (and connect, verify, disconnect). Null for anything unusable. */
export function readDomainState(body: unknown): DomainState | null {
  if (!isRecord(body) || !STATUSES.includes(String(body.customDomainStatus))) return null;
  const records: DnsRecord[] = [];
  if (Array.isArray(body.dnsRecords)) {
    for (const r of body.dnsRecords) {
      if (isRecord(r) && (r.type === "CNAME" || r.type === "A" || r.type === "TXT") && typeof r.name === "string" && typeof r.value === "string") {
        records.push({ type: r.type, name: r.name, value: r.value });
      }
    }
  }
  return {
    domain: typeof body.domain === "string" && body.domain !== "" ? body.domain : null,
    status: body.customDomainStatus as DomainStatus,
    dnsRecords: records,
    failureReason: typeof body.failureReason === "string" ? body.failureReason : null,
    failureMessage: typeof body.failureMessage === "string" ? body.failureMessage : null,
    checkedAt: typeof body.checkedAt === "string" ? body.checkedAt : null,
    vercelConfigured: body.vercelConfigured === true,
    planAllowsCustomDomain: body.planAllowsCustomDomain !== false,
    redirectToCustomDomain: body.redirectToCustomDomain === true,
  };
}

export const STATUS_LABELS: Record<DomainStatus, string> = {
  unset: "Not connected",
  pending: "Waiting for DNS",
  verified: "Connected",
  failed: "Not working yet",
};

/** One short line that says what to do now, for the status the store is in. */
export function nextStepText(state: DomainState): string {
  switch (state.status) {
    case "verified":
      return `Your store is live at https://${state.domain}.`;
    case "failed":
      return "We could not confirm your DNS yet. Fix the records below, wait a few minutes, then press Check now.";
    case "pending":
      return "Add the records below at the company where you bought your domain. Then press Check now.";
    default:
      return "Type the domain you own, for example shop.yourbrand.pk.";
  }
}

/** The steps shown beside the records: what to do, in order. */
export function dnsSteps(state: DomainState): string[] {
  if (state.domain === null || state.dnsRecords.length === 0) return [];
  return [
    "Open the website of the company where you bought your domain.",
    "Find DNS settings (they may call it DNS Management or Name Servers).",
    "Add each record below. Copy the values exactly.",
    "Wait 5 to 30 minutes (sometimes longer), then press Check now.",
  ];
}

/** Whether the Check now button should be offered. */
export const canVerify = (state: DomainState): boolean => state.domain !== null && state.planAllowsCustomDomain && state.dnsRecords.length > 0;

/** Whether the connect form is shown (no domain yet, or the seller chose to change it). */
export const canConnect = (state: DomainState): boolean => state.planAllowsCustomDomain;

export interface DomainFailure {
  message: string;
  /** True when the page should show the upgrade hint (the plan has no custom domain). */
  upgrade: boolean;
  /** The field to mark, when the answer names one. */
  field: "domain" | null;
}

/** Turns an error from the proxy ({ error, code, details }) into the words the page shows. */
export function domainFailure(status: number, body: unknown): DomainFailure {
  const rec = isRecord(body) ? body : {};
  const code = typeof rec.code === "string" ? rec.code : "";
  const message = typeof rec.error === "string" ? rec.error : "";
  if (code === "PLAN_LIMIT_REACHED") {
    return { message: "A custom domain is part of the Growth plan. Upgrade to connect your own domain.", upgrade: true, field: null };
  }
  if (code === "DOMAIN_TAKEN") return { message: "This domain is already used by another store. Use a different domain.", upgrade: false, field: "domain" };
  if (code === "DOMAIN_INVALID") return { message: message || "This is not a valid domain.", upgrade: false, field: "domain" };
  if (code === "DOMAIN_REMOVE_FAILED") return { message: "We could not switch your domain off. Please try again in a few minutes.", upgrade: false, field: null };
  if (status === 429) return { message: "You checked too many times. Please wait a while and try again.", upgrade: false, field: null };
  if (status === 401) return { message: "Your session ended. Please sign in again.", upgrade: false, field: null };
  if (status === 409) return { message: message || "Your domain changed. Reload the page and try again.", upgrade: false, field: null };
  return { message: message || "Something went wrong. Please try again.", upgrade: false, field: null };
}

/** The time of the last check, in plain words, or null when none was made. */
export function checkedText(iso: string | null, now: Date = new Date()): string | null {
  if (iso === null) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const minutes = Math.max(0, Math.round((now.getTime() - then.getTime()) / 60000));
  if (minutes < 1) return "Checked just now";
  if (minutes < 60) return `Checked ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Checked ${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `Checked ${Math.round(hours / 24)} days ago`;
}

/** The redirect switch is shown only for a VERIFIED domain (it does nothing before that). */
export const canSetRedirect = (state: DomainState): boolean => state.domain !== null && state.status === "verified";

/** The body of the settings save for the switch: the `domain` group of PATCH /api/proxy/stores/:id. */
export const redirectSettingBody = (on: boolean): { domain: { redirectToCustomDomain: boolean } } => ({ domain: { redirectToCustomDomain: on } });

/** What the switch says, in plain words. */
export function redirectText(on: boolean, domain: string): string {
  return on
    ? `Visitors who open your Markazify address are sent to ${domain}.`
    : `Your Markazify address keeps working next to ${domain}. Turn this on to send visitors to ${domain} instead.`;
}
