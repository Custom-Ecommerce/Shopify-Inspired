import { NextResponse } from "next/server";
import { resolveClientIp } from "@markaz/platform-kit/client-ip";
import { signedClientAddressHeaders } from "@markaz/platform-kit/signed-client-address";
import { PLATFORM_CONTACT_SCOPE, buildPlatformContactBody, platformContactAnswer } from "@markaz/storefront-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 8000;

/**
 * POST /api/contact (Sprint 7, S7-B4): the platform's own contact form (the marketing site). It used to answer "received" without keeping anything (the
 * "silent success"). Now the message goes to the seller backend's public route (POST /api/storefront/v1/contact), which STORES it as a platform contact
 * message and queues an email to the support address of the platform settings. The answer is a success ONLY when that route says it stored the message; a
 * timeout, an unreachable backend or any other answer is an error (platformContactAnswer, with its check file). The honeypot (bot-field) is forwarded and
 * answered like a success by the backend, which keeps nothing. The visitor's address is signed for the backend's limiter (5 messages per 10 minutes).
 */
export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "The form could not be read." }, { status: 400 });
  }
  const built = buildPlatformContactBody(raw);
  if (!built.ok) return NextResponse.json({ error: built.message, field: built.field }, { status: 400 });

  const base = (process.env.SELLER_BACKEND_API_URL || "http://localhost:4001").replace(/\/+$/, "");
  const ip = resolveClientIp(request.headers, process.env);
  let status = 0;
  let payload: unknown = null;
  let retryAfter: string | null = null;
  try {
    const response = await fetch(base + "/api/storefront/v1/contact", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(ip && ip !== "unknown" ? { "x-forwarded-for": ip } : {}),
        ...signedClientAddressHeaders(process.env.CLIENT_ADDRESS_SIGNING_SECRET ?? "", PLATFORM_CONTACT_SCOPE, ip),
      },
      body: JSON.stringify(built.body),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = response.status;
    retryAfter = response.headers.get("retry-after");
    payload = await response.json().catch(() => null);
  } catch (error) {
    console.error("Contact form: the seller backend could not be reached", error instanceof Error ? error.name : "unknown");
  }
  const answer = platformContactAnswer(status, payload, retryAfter);
  return NextResponse.json(answer.body, { status: answer.status, headers: answer.retryAfter === undefined ? {} : { "Retry-After": String(answer.retryAfter) } });
}
