import type { EmailProvider } from '../types';
import { createLogProvider, createUnconfiguredProvider } from './log';
import { createResendProvider } from './resend';
import { createSmtpProvider } from './smtp';

export const EMAIL_PROVIDER_NAMES = ['resend', 'smtp', 'log'] as const;
export type EmailProviderName = (typeof EMAIL_PROVIDER_NAMES)[number];

type Env = Record<string, string | undefined>;

const value = (env: Env, name: string): string => (env[name] ?? '').trim();

/**
 * The provider EMAIL_PROVIDER names (A-021): resend (RESEND_API_KEY, EMAIL_FROM), smtp (SMTP_HOST, SMTP_PORT, SMTP_USER,
 * SMTP_PASS, EMAIL_FROM) or log. Empty means log, so development works with nothing set. A named provider with missing
 * settings, or an unknown name, gives the unconfigured provider: messages fail and wait for a retry, rather than being
 * marked skipped and silently lost. The reason names the missing variable, never its value.
 */
export function providerFromEnv(env: Env = process.env): EmailProvider {
  const name = value(env, 'EMAIL_PROVIDER').toLowerCase();
  const from = value(env, 'EMAIL_FROM');

  if (name === '' || name === 'log') return createLogProvider();

  if (name === 'resend') {
    const apiKey = value(env, 'RESEND_API_KEY');
    if (apiKey === '' || from === '') return createUnconfiguredProvider('EMAIL_PROVIDER=resend needs RESEND_API_KEY and EMAIL_FROM');
    return createResendProvider({ apiKey, from });
  }

  if (name === 'smtp') {
    const host = value(env, 'SMTP_HOST');
    const portText = value(env, 'SMTP_PORT');
    const port = portText === '' ? 587 : Number.parseInt(portText, 10);
    if (host === '' || from === '' || !Number.isInteger(port) || port <= 0 || port > 65535) {
      return createUnconfiguredProvider('EMAIL_PROVIDER=smtp needs SMTP_HOST, a valid SMTP_PORT and EMAIL_FROM');
    }
    return createSmtpProvider({ host, port, user: value(env, 'SMTP_USER'), pass: env.SMTP_PASS ?? '', from });
  }

  return createUnconfiguredProvider('EMAIL_PROVIDER must be resend, smtp or log');
}
