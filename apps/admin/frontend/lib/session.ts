import { backendFetch } from "@/lib/backend";
import { sessionUserSchema, type SessionUser } from "@/lib/contracts";

export type SessionResult = { status: "ok"; user: SessionUser; adminLevel: string; capabilities: string[] } | { status: "unauthorized" } | { status: "unavailable" };

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
  const payload = (await response.json().catch(() => null)) as { user?: unknown; adminLevel?: unknown; capabilities?: unknown } | null;
  const parsed = sessionUserSchema.safeParse(payload?.user);
  if (!parsed.success) return { status: "unavailable" };
  if (parsed.data.role !== "admin") return { status: "unauthorized" };
  // Sprint 6 (S6-B6): the level and the capability list, for the console to follow. A backend that does not send them (older) means all.
  const capabilities = Array.isArray(payload?.capabilities) ? payload.capabilities.filter((c): c is string => typeof c === "string") : [];
  return { status: "ok", user: parsed.data, adminLevel: typeof payload?.adminLevel === "string" ? payload.adminLevel : "owner", capabilities };
}
