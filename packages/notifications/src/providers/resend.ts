import { errorText } from '../errors';
import type { EmailMessage, EmailProvider, SendResult } from '../types';

export const RESEND_API_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ResendOptions {
  apiKey: string;
  from: string;
  /** Injected by tests. Defaults to the global fetch. */
  fetchImpl?: FetchLike;
}

/** 429 and every 5xx can succeed later; any other refusal (bad address, unverified sender) will not. */
function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Resend over its REST API (A-021): one POST per message, no SDK. The key is only ever sent in the Authorization header. */
export function createResendProvider(options: ResendOptions): EmailProvider {
  const doFetch: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  return {
    name: 'resend',
    async send(message: EmailMessage): Promise<SendResult> {
      let response: Response;
      try {
        response = await doFetch(RESEND_API_URL, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + options.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: options.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        return { ok: false, error: 'resend request failed: ' + errorText(err), retryable: true };
      }

      if (response.ok) {
        let id: string | null = null;
        try {
          const body = (await response.json()) as { id?: unknown };
          id = typeof body.id === 'string' ? body.id : null;
        } catch {
          id = null;
        }
        return { ok: true, status: 'sent', providerMessageId: id };
      }

      let detail = '';
      try {
        const body = (await response.json()) as { message?: unknown; name?: unknown };
        detail = typeof body.message === 'string' ? body.message : typeof body.name === 'string' ? body.name : '';
      } catch {
        detail = '';
      }
      return { ok: false, error: errorText('resend answered ' + response.status + (detail ? ': ' + detail : '')), retryable: retryableStatus(response.status) };
    },
  };
}
