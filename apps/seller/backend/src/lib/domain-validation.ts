import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

/**
 * S7-B5 (D-118): what a seller may type as a custom domain. Pure: no I/O. The host is refused rather than repaired when it is not a plain
 * host name (a pasted https://shop.com/ is refused with a clear message), and the answer is the lower-case punycode form.
 */

export interface DomainValidationOk {
  ok: true;
  host: string;
}
export interface DomainValidationRefused {
  ok: false;
  reason: string;
  message: string;
}
export type DomainValidation = DomainValidationOk | DomainValidationRefused;

/** Top-level labels that never name a public site (internal, test and example names). */
const RESERVED_TLDS = new Set(['localhost', 'local', 'internal', 'localdomain', 'lan', 'home', 'corp', 'intranet', 'test', 'example', 'invalid', 'onion', 'arpa']);
/** Hosts of the hosting provider itself: a seller cannot claim a name under them. */
const FORBIDDEN_SUFFIXES = ['vercel.app', 'vercel.com', 'vercel.dev', 'now.sh'];

const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const TLD = /^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

const refuse = (reason: string, message: string): DomainValidationRefused => ({ ok: false, reason, message });

/** A platform host without its port, lower-case, no dots at the ends. */
export function normalisePlatformHost(raw: string): string {
  let host = raw.trim().toLowerCase();
  if (host.startsWith('[')) return host;
  host = host.replace(/:\d+$/, '').replace(/^\.+|\.+$/g, '');
  return host;
}

/**
 * The platform's own host names, from the same settings the storefront tenancy code reads: ROOT_DOMAIN, PLATFORM_HOSTNAMES, and the host of
 * STOREFRONT_URL (this backend's own setting for the storefront). A leading www is the same host.
 */
export function platformHostsFromEnv(env: Record<string, string | undefined> = process.env): string[] {
  const out = new Set<string>();
  const add = (value: string | undefined): void => {
    if (!value) return;
    const host = normalisePlatformHost(value);
    if (host !== '') out.add(host.replace(/^www\./, ''));
  };
  add(env.ROOT_DOMAIN);
  for (const item of (env.PLATFORM_HOSTNAMES ?? '').split(',')) add(item);
  try {
    if (env.STOREFRONT_URL) add(new URL(env.STOREFRONT_URL).hostname);
  } catch {
    // an unusable STOREFRONT_URL names no host
  }
  return [...out];
}

export function validateCustomDomain(input: unknown, platformHosts: readonly string[] = platformHostsFromEnv()): DomainValidation {
  if (typeof input !== 'string') return refuse('type', 'Enter your domain, for example shop.yourbrand.pk.');
  const raw = input.trim();
  if (raw === '') return refuse('empty', 'Enter your domain, for example shop.yourbrand.pk.');
  if (raw.includes('://') || raw.startsWith('//')) return refuse('scheme', 'Enter only the domain, without http:// or https://.');
  if (/\s/.test(raw)) return refuse('space', 'A domain cannot contain spaces.');
  if (/[/?#\\]/.test(raw)) return refuse('path', 'Enter only the domain, without a path or extra parts (for example shop.yourbrand.pk).');
  if (raw.includes('@')) return refuse('userinfo', 'Enter only the domain, without a user name.');
  if (raw.includes('[') || raw.includes(']') || (raw.match(/:/g) ?? []).length > 1) return refuse('ip', 'An IP address cannot be used. Use a domain name.');
  if (raw.includes(':')) return refuse('port', 'Enter the domain without a port number.');
  if (raw.endsWith('.')) return refuse('trailing-dot', 'Remove the dot at the end of the domain.');
  if (raw.startsWith('.')) return refuse('leading-dot', 'A domain cannot start with a dot.');
  if (raw.includes('*')) return refuse('wildcard', 'A wildcard domain cannot be used. Enter one full domain.');
  if (isIP(raw) !== 0) return refuse('ip', 'An IP address cannot be used. Use a domain name.');

  // A last part that is all digits (or 0x...) makes the URL parser read the whole name as an IPv4 address and refuse it, so say so before it does.
  const lastPart = raw.toLowerCase().split('.').pop() ?? '';
  if (/^[0-9]+$/.test(lastPart) || /^0x[0-9a-f]*$/.test(lastPart)) return refuse('ip', 'An IP address cannot be used. Use a domain name.');

  const ascii = domainToASCII(raw.toLowerCase());
  if (ascii === '') return refuse('characters', 'This domain has characters that are not allowed.');
  if (ascii.length > 253) return refuse('too-long', 'This domain is too long (253 characters at most).');
  if (isIP(ascii) !== 0) return refuse('ip', 'An IP address cannot be used. Use a domain name.');

  const labels = ascii.split('.');
  if (labels.length < 2) return refuse('no-dot', 'Enter a full domain with a dot, for example shop.yourbrand.pk.');
  if (labels.some((label) => label === '')) return refuse('empty-label', 'A domain cannot have two dots in a row.');
  if (labels.some((label) => label.length > 63)) return refuse('label-too-long', 'Each part of the domain can have 63 characters at most.');
  if (labels.some((label) => !LABEL.test(label))) return refuse('characters', 'Use only letters, numbers and hyphens (a hyphen cannot start or end a part).');
  const tld = labels[labels.length - 1]!;
  if (/^[0-9]+$/.test(tld) || /^0x[0-9a-f]*$/.test(tld)) return refuse('ip', 'An IP address cannot be used. Use a domain name.');
  if (RESERVED_TLDS.has(tld)) return refuse('reserved', 'This name is reserved and cannot be used as a store domain.');
  if (!TLD.test(tld)) return refuse('tld', 'The end of the domain (like .com or .pk) is not valid.');

  for (const platform of platformHosts) {
    const base = normalisePlatformHost(platform).replace(/^www\./, '');
    if (base !== '' && (ascii === base || ascii === 'www.' + base || ascii.endsWith('.' + base))) {
      return refuse('platform', 'This is a Markazify address. Use your own domain.');
    }
  }
  if (FORBIDDEN_SUFFIXES.some((suffix) => ascii === suffix || ascii.endsWith('.' + suffix))) return refuse('reserved', 'This name is reserved and cannot be used as a store domain.');
  return { ok: true, host: ascii };
}
