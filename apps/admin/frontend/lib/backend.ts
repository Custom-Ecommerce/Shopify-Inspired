import { backendBaseUrl } from "@/lib/env";

export class BackendUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendUnavailableError";
  }
}

/**
 * How long to wait for the admin backend. In `next dev` the first request after a restart compiles the route and
 * opens the database connection, which can take about 10 seconds, so development waits longer. Production keeps 10s.
 */
function backendTimeoutMs(): number {
  return process.env.NODE_ENV === "development" ? 60000 : 10000;
}

/** Calls the admin backend from the server. Never cached. Throws BackendUnavailableError if it cannot be reached. */
export async function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = backendBaseUrl();
  if (base === null) throw new BackendUnavailableError("ADMIN_BACKEND_API_URL is not set");
  try {
    return await fetch(base + path, { ...init, cache: "no-store", signal: AbortSignal.timeout(backendTimeoutMs()) });
  } catch {
    throw new BackendUnavailableError("The admin backend did not answer");
  }
}
