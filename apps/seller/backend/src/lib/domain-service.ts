import { randomBytes } from 'node:crypto';
import type { AuthRateRule } from '@markaz/auth';
import { DnsLookupError, type DnsResolverPort } from '@/lib/domain-dns';

/**
 * S7-B5 (D-118): the pure parts of a custom domain. The records a seller must set, the DNS check against them, the wording of a failure, and
 * the answer the routes give. No database here; the routes in api/stores/[id]/domain use it.
 */

export const VERIFY_LABEL = '_markazify-verify';
const HOUR_MS = 3_600_000;
/** D-081: 10 DNS checks per store per hour, on the shared Mongo counters. */
export const DOMAIN_VERIFY_RULE: AuthRateRule = { name: 'domain-verify-store', limit: 10, windowMs: HOUR_MS };

export type DomainStatus = 'unset' | 'pending' | 'verified' | 'failed';
export type DomainFailureReason = 'token_missing' | 'target_wrong' | 'dns_error' | 'dns_timeout' | 'vercel_failed';

export const FAILURE_MESSAGES: Readonly<Record<DomainFailureReason, string>> = {
  token_missing: 'We could not find the verification (TXT) record yet. Add it at your domain provider, wait a few minutes, then check again.',
  target_wrong: 'The verification record is there, but your domain does not point to us yet. Check the CNAME or A record.',
  dns_error: 'We could not read your DNS records right now. Please try again in a few minutes.',
  dns_timeout: 'Your DNS records took too long to answer. Please try again in a few minutes.',
  vercel_failed: 'Your records are correct, but we could not switch your domain on yet. Please try again in a few minutes.',
};

export const isFailureReason = (value: unknown): value is DomainFailureReason => typeof value === 'string' && Object.prototype.hasOwnProperty.call(FAILURE_MESSAGES, value);

export interface DomainRecord {
  type: 'CNAME' | 'A' | 'TXT';
  name: string;
  value: string;
}

export interface DomainTargets {
  cname: string | null;
  a: string | null;
}

/** CUSTOM_DOMAIN_CNAME_TARGET and CUSTOM_DOMAIN_A_TARGET (both optional). */
export function domainTargets(env: Record<string, string | undefined> = process.env): DomainTargets {
  const clean = (value: string | undefined): string | null => {
    const v = (value ?? '').trim().toLowerCase().replace(/\.$/, '');
    return v === '' ? null : v;
  };
  return { cname: clean(env.CUSTOM_DOMAIN_CNAME_TARGET), a: clean(env.CUSTOM_DOMAIN_A_TARGET) };
}

/** A new ownership token: 36 hex characters from the system's random source. */
export function newDomainToken(): string {
  return 'mz-' + randomBytes(18).toString('hex');
}

/** A name with two parts (shop.pk style apex) cannot hold a CNAME: it gets the A record when there is one. */
const looksLikeApex = (host: string): boolean => host.split('.').length === 2;

/** The records to set: the routing record (CNAME or A, as the host and the settings allow), then the TXT ownership record. */
export function dnsRecordsFor(host: string, token: string, targets: DomainTargets): DomainRecord[] {
  const records: DomainRecord[] = [];
  if (targets.a !== null && (looksLikeApex(host) || targets.cname === null)) records.push({ type: 'A', name: host, value: targets.a });
  else if (targets.cname !== null) records.push({ type: 'CNAME', name: host, value: targets.cname });
  records.push({ type: 'TXT', name: VERIFY_LABEL + '.' + host, value: token });
  return records;
}

export type DnsCheck = { ok: true } | { ok: false; reason: Exclude<DomainFailureReason, 'vercel_failed'> };

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase().replace(/\.$/, '') === b.trim().toLowerCase().replace(/\.$/, '');

/**
 * Checks the live DNS of a host: the TXT token must be there, and (when a target is configured) the CNAME or an A record must point at
 * us. A resolver failure is a reason of its own. Never throws.
 */
export async function checkDomainDns(resolver: DnsResolverPort, host: string, token: string, targets: DomainTargets): Promise<DnsCheck> {
  try {
    const txt = await resolver.resolveTxt(VERIFY_LABEL + '.' + host);
    if (!txt.some((value) => value.trim() === token)) return { ok: false, reason: 'token_missing' };
    if (targets.cname === null && targets.a === null) return { ok: true };
    const wanted = targets;
    if (wanted.cname !== null) {
      const cnames = await resolver.resolveCname(host);
      if (cnames.some((value) => sameName(value, wanted.cname as string))) return { ok: true };
    }
    if (wanted.a !== null) {
      const addresses = await resolver.resolve4(host);
      if (addresses.some((value) => value.trim() === wanted.a)) return { ok: true };
    }
    return { ok: false, reason: 'target_wrong' };
  } catch (err) {
    return { ok: false, reason: err instanceof DnsLookupError && err.kind === 'timeout' ? 'dns_timeout' : 'dns_error' };
  }
}

export interface DomainStoreFields {
  domain?: unknown;
  customDomainStatus?: unknown;
  domainToken?: unknown;
  domainCheckedAt?: unknown;
  domainFailureReason?: unknown;
  /** S7-B6: read for the redirect setting only. */
  storefront?: unknown;
}

export interface DomainStateWire {
  domain: string | null;
  customDomainStatus: DomainStatus;
  dnsRecords: DomainRecord[];
  failureReason: DomainFailureReason | null;
  failureMessage: string | null;
  checkedAt: string | null;
  vercelConfigured: boolean;
  planAllowsCustomDomain: boolean;
  /** S7-B6: the seller's "redirect the platform address to this domain" setting (OFF by default). It acts only while the domain is verified. */
  redirectToCustomDomain: boolean;
}

const STATUSES: readonly string[] = ['unset', 'pending', 'verified', 'failed'];

const iso = (value: unknown): string | null => {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  return date !== null && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
};

/** The answer of every domain route. The token appears only inside the TXT record, and only for a store that has a host. */
export function toDomainState(doc: DomainStoreFields | null, extra: { vercelConfigured: boolean; planAllowsCustomDomain: boolean; targets?: DomainTargets }): DomainStateWire {
  const domain = typeof doc?.domain === 'string' && doc.domain !== '' ? doc.domain : null;
  const status = typeof doc?.customDomainStatus === 'string' && STATUSES.includes(doc.customDomainStatus) ? (doc.customDomainStatus as DomainStatus) : 'unset';
  const token = typeof doc?.domainToken === 'string' && doc.domainToken !== '' ? doc.domainToken : null;
  const rawReason: unknown = doc?.domainFailureReason;
  const reason: DomainFailureReason | null = isFailureReason(rawReason) ? rawReason : null;
  const live = domain !== null;
  return {
    domain,
    customDomainStatus: live ? (status === 'unset' ? 'pending' : status) : 'unset',
    dnsRecords: live && token !== null ? dnsRecordsFor(domain, token, extra.targets ?? domainTargets()) : [],
    failureReason: live ? reason : null,
    failureMessage: live && reason !== null ? FAILURE_MESSAGES[reason] : null,
    checkedAt: live ? iso(doc?.domainCheckedAt) : null,
    vercelConfigured: extra.vercelConfigured,
    planAllowsCustomDomain: extra.planAllowsCustomDomain,
    redirectToCustomDomain: live && typeof doc?.storefront === 'object' && doc.storefront !== null && (doc.storefront as { redirectToCustomDomain?: unknown }).redirectToCustomDomain === true,
  };
}
