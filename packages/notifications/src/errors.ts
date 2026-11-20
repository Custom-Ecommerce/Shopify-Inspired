/** At most this many characters of an error are stored on the outbox row (lastError) or logged. */
export const ERROR_TEXT_MAX = 300;

/**
 * One short line describing an error, safe to store and log: no stack, no request, no headers. Providers never put a key
 * or a password into their errors, and anything that looks like a bearer token or an API key is masked anyway.
 */
export function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : 'unknown error';
  const masked = raw
    .replace(/Bearer\s+\S+/gi, 'Bearer ***')
    .replace(/\bre_[A-Za-z0-9_]{8,}\b/g, 're_***')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .trim();
  return (masked === '' ? 'unknown error' : masked).slice(0, ERROR_TEXT_MAX);
}

/** The domain part of an address, for logs: who a message went to is personal data, the domain is enough to debug. */
export function recipientDomain(to: string): string {
  const at = to.lastIndexOf('@');
  return at >= 0 ? to.slice(at + 1).toLowerCase() : 'unknown';
}
