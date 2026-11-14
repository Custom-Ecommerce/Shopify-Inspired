import { recipientDomain } from '../errors';
import type { EmailMessage, EmailProvider, SendResult } from '../types';

/**
 * Development provider (D-091): nothing leaves the platform. The full message already sits on the outbox row, so the log
 * line carries only the subject and the recipient's domain: a body can hold a reset link, and an address is personal data.
 */
export function createLogProvider(log: (line: string, detail: Record<string, unknown>) => void = (line, detail) => console.info(line, detail)): EmailProvider {
  return {
    name: 'log',
    async send(message: EmailMessage): Promise<SendResult> {
      log('[notifications] log provider: email kept in the outbox, not sent', { subject: message.subject, toDomain: recipientDomain(message.to) });
      return { ok: true, status: 'skipped' };
    },
  };
}

/**
 * EMAIL_PROVIDER names a real provider but its settings are incomplete. Every send fails as retryable, so the messages
 * stay in the outbox as failed and a later flush can still send them once the settings are fixed.
 */
export function createUnconfiguredProvider(reason: string): EmailProvider {
  return {
    name: 'unconfigured',
    async send(): Promise<SendResult> {
      return { ok: false, error: reason, retryable: true };
    },
  };
}
