import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { PasswordFlowForm } from "@/components/auth/password-flow-form";

export const metadata: Metadata = { title: "Forgot password" };

export default function Page() {
  return (
    <AuthShell>
      <PasswordFlowForm flow="forgot" />
    </AuthShell>
  );
}
