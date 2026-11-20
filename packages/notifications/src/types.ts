/**
 * Shared types of the notification core (D-091). Email is the only channel that is sent; WhatsApp is a wa.me link
 * the seller or shopper opens by hand (see whatsapp.ts), so it never goes through the outbox.
 */

export const NOTIFICATION_CHANNELS = ['email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** queued: waiting to be sent. sent: the provider accepted it. failed: the last try failed (retried while attempts remain).
 *  skipped: the log provider kept it and nothing left the platform (development, or no provider configured). */
export const OUTBOX_STATUSES = ['queued', 'sent', 'failed', 'skipped'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/** The message a provider is asked to deliver. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * What a provider answers. A provider never throws for a delivery problem: it returns ok false. retryable says whether a
 * later try can succeed (network, 5xx, 429, not configured) or not (the provider refused the message itself, e.g. a bad address).
 */
export type SendResult =
  | { ok: true; status: 'sent'; providerMessageId?: string | null }
  | { ok: true; status: 'skipped' }
  | { ok: false; error: string; retryable: boolean };

export interface EmailProvider {
  /** resend | smtp | log | unconfigured. Logged, never a secret. */
  readonly name: string;
  send(message: EmailMessage): Promise<SendResult>;
}
