import { Resolver } from 'node:dns/promises';

/**
 * S7-B5: the DNS lookups a domain check needs, behind a port. The real one is node:dns with a timeout; the tests install a fake. A
 * name that does not exist (ENOTFOUND, ENODATA) is an empty answer, anything else is a DnsLookupError.
 */

export class DnsLookupError extends Error {
  readonly kind: 'timeout' | 'error';
  constructor(kind: 'timeout' | 'error', message: string) {
    super(message);
    this.name = 'DnsLookupError';
    this.kind = kind;
  }
}

export interface DnsResolverPort {
  /** Every TXT record of the name, each as one joined string. */
  resolveTxt(name: string): Promise<string[]>;
  resolveCname(name: string): Promise<string[]>;
  resolve4(name: string): Promise<string[]>;
}

export const DNS_TIMEOUT_MS = 4000;
const EMPTY_CODES = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN', 'NOTFOUND']);
const TIMEOUT_CODES = new Set(['ETIMEOUT', 'ETIMEDOUT']);

/** The real resolver. `timeoutMs` bounds each lookup, whatever the system resolver does. */
export function createNodeDnsResolver(timeoutMs: number = DNS_TIMEOUT_MS): DnsResolverPort {
  const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
  const run = async (lookup: () => Promise<string[]>): Promise<string[]> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const guard = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DnsLookupError('timeout', 'The DNS lookup timed out')), timeoutMs + 500);
      });
      return await Promise.race([lookup(), guard]);
    } catch (err) {
      if (err instanceof DnsLookupError) throw err;
      const code = (err as { code?: unknown } | null)?.code;
      if (typeof code === 'string' && EMPTY_CODES.has(code)) return [];
      if (typeof code === 'string' && TIMEOUT_CODES.has(code)) throw new DnsLookupError('timeout', 'The DNS lookup timed out');
      throw new DnsLookupError('error', 'The DNS lookup failed' + (typeof code === 'string' ? ' (' + code + ')' : ''));
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  return {
    resolveTxt: (name) => run(async () => (await resolver.resolveTxt(name)).map((chunks) => chunks.join(''))),
    resolveCname: (name) => run(() => resolver.resolveCname(name)),
    resolve4: (name) => run(() => resolver.resolve4(name)),
  };
}

export interface FakeDnsData {
  txt?: Record<string, string[]>;
  cname?: Record<string, string[]>;
  a?: Record<string, string[]>;
  /** A name whose every lookup fails: 'timeout' or 'error'. */
  failing?: Record<string, 'timeout' | 'error'>;
}

/** A fake for tests: answers from the data it was given, records every name asked. */
export function createFakeDnsResolver(data: FakeDnsData = {}): DnsResolverPort & { asked: string[] } {
  const asked: string[] = [];
  const answer = (table: Record<string, string[]> | undefined, name: string): string[] => {
    asked.push(name);
    const failing = data.failing?.[name];
    if (failing) throw new DnsLookupError(failing, 'fake DNS failure');
    return [...(table?.[name] ?? [])];
  };
  return {
    asked,
    resolveTxt: async (name) => answer(data.txt, name),
    resolveCname: async (name) => answer(data.cname, name),
    resolve4: async (name) => answer(data.a, name),
  };
}

let override: DnsResolverPort | null = null;
let real: DnsResolverPort | null = null;

/** Test seam: replaces the resolver (null puts the real one back). */
export function setDnsResolver(resolver: DnsResolverPort | null): void {
  override = resolver;
}

export function getDnsResolver(): DnsResolverPort {
  if (override) return override;
  real ??= createNodeDnsResolver();
  return real;
}
