import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { UsersView } from "@/components/users/users-view";
import { SESSION_COOKIE } from "@/lib/cookie";
import { readSession } from "@/lib/session";

export const metadata: Metadata = { title: "Admin users" };

export default async function UsersPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await readSession(token) : null;
  // The server refuses everyone but an owner; this only keeps the page out of sight of the other levels.
  if (session?.status === "ok" && !session.capabilities.includes("users.manage")) redirect("/");
  return (
    <Suspense fallback={null}>
      <UsersView selfId={session?.status === "ok" ? session.user.id : ""} />
    </Suspense>
  );
}
