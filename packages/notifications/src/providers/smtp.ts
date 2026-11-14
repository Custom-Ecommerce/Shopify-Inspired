import { errorText } from '../errors';
import type { EmailMessage, EmailProvider, SendResult } from '../types';

export interface SmtpOptions {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

/** The one call this provider makes on a nodemailer transport. Tests inject a fake. */
export interface MailTransport {
  sendMail(mail: { from: string; to: string; subject: string; text: string; html: string }): Promise<{ messageId?: string }>;
}

/** Codes nodemailer gives for a refusal that a retry will not fix (bad recipient, auth refused). */
const PERMANENT_RESPONSE = /^5\d\d$/;

async function defaultTransport(options: SmtpOptions): Promise<MailTransport> {
  // Loaded only when SMTP is chosen, so an app that uses Resend or the log provider never loads nodemailer.
  const mod = await import('nodemailer');
  const nodemailer = (mod as unknown as { default?: typeof mod }).default ?? mod;
  return nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: options.port === 465,
    auth: options.user !== '' ? { user: options.user, pass: options.pass } : undefined,
  });
}

/** SMTP through nodemailer (the A-021 fallback). The transport is made once, on the first message. */
export function createSmtpProvider(options: SmtpOptions, makeTransport: (o: SmtpOptions) => Promise<MailTransport> = defaultTransport): EmailProvider {
  let transport: Promise<MailTransport> | null = null;
  return {
    name: 'smtp',
    async send(message: EmailMessage): Promise<SendResult> {
      try {
        if (transport === null) {
          const pending = makeTransport(options);
          // A failed setup must not be cached for the life of the process.
          pending.catch(() => {
            if (transport === pending) transport = null;
          });
          transport = pending;
        }
        const info = await (await transport).sendMail({ from: options.from, to: message.to, subject: message.subject, text: message.text, html: message.html });
        return { ok: true, status: 'sent', providerMessageId: info.messageId ?? null };
      } catch (err) {
        const responseCode = String((err as { responseCode?: unknown }).responseCode ?? '');
        return { ok: false, error: 'smtp send failed: ' + errorText(err), retryable: !PERMANENT_RESPONSE.test(responseCode) };
      }
    },
  };
}
