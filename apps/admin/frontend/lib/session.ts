import { backendFetch } from "@/lib/backend";
import { sessionUserSchema, type SessionUser } from "@/lib/contracts";

export type SessionResult = { status: "ok"; user: SessionUser } | { status: "unauthorized" } | { status: "unavailable" };

/** Asks the backend who the token belongs to. A token the backend refuses is unauthorized; any other failure is unavailable. */
export async function readSession(token: string): Promise<SessionResult> {
  let response: Response;
  try {
    response = await backendFetch("/api/admin/me", { headers: { authorization: "Bearer " + token } });
  } catch {
    return { status: "unavailable" };
  }
  if (response.status === 401) return { status: "unauthorized" };
  if (!response.ok) return { status: "unavailable" };
  const payload = (await response.json().catch(() => null)) as { user?: unknown } | null;
  const parsed = sessionUserSchema.safeParse(payload?.user);
  if (!parsed.success) return { status: "unavailable" };
  if (parsed.data.role !== "admin") return { status: "unauthorized" };
  return { status: "ok", user: parsed.data };
}
