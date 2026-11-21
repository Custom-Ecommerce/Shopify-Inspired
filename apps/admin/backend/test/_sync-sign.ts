import { buildSyncHeaders } from '@markaz/platform-kit/hmac';

/** The x-sync-* headers of a signed sync call (key id "default", the envelope is the raw body). Test helper only. */
export async function signHmacHeaders(rawBody: string, secret: string): Promise<Record<string, string>> {
  return { ...buildSyncHeaders({ keyId: 'default', secret, rawBody }) };
}
