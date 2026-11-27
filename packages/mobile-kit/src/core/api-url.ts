export interface ApiUrlInput {
  /** EXPO_PUBLIC_..._API_URL of the app. */
  configured?: string | null;
  /** "192.168.1.5:8081": where Expo Go loaded the app from. */
  hostUri?: string | null;
  /** The backend's port on a developer's computer. */
  devPort: number;
  dev: boolean;
}

export type ApiUrlResult = { ok: true; url: string } | { ok: false; problem: string };

/**
 * Which backend the app talks to. The configured address wins. In development only, with none configured, the computer that serves the app to Expo Go is
 * assumed to run the backend too. A release build needs an https address: tokens never travel in the clear.
 */
export function resolveApiUrl(input: ApiUrlInput): ApiUrlResult {
  const configured = input.configured?.trim().replace(/\/+$/, '');
  if (configured) {
    if (!/^https?:\/\/[^\s/?#@]+(\/[^\s?#]*)?$/.test(configured)) return { ok: false, problem: 'The server address is not a web address.' };
    if (!input.dev && !configured.startsWith('https://')) return { ok: false, problem: 'A release build needs an https server address.' };
    return { ok: true, url: configured };
  }
  if (input.dev) {
    const host = input.hostUri?.split('/')[0]?.replace(/:\d+$/, '');
    // A tunnel host serves only the app bundle, not the backend.
    if (host && /^(localhost|\d{1,3}(\.\d{1,3}){3})$/.test(host)) return { ok: true, url: `http://${host}:${input.devPort}` };
  }
  return { ok: false, problem: 'No server address is set for this app.' };
}
