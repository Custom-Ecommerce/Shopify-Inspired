import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { PasswordFlowForm } from "@/components/auth/password-flow-form";

export const metadata: Metadata = { title: "Accept invitation" };

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthShell>
      <PasswordFlowForm flow="invite" token={typeof token === "string" ? token : null} />
    </AuthShell>
  );
}
