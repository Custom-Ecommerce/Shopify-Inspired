/**
 * `/stores/new` — "Create Your Store" (Blueprint §6.6). Lives outside any store, so it uses the
 * workspace chrome and needs no store context. The form posts to `/api/workspace/stores`.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { Surface } from "@/components/shared/Surface";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { WorkspaceShell } from "@/components/dashboard/WorkspaceShell";
import { authFailureView } from "@/components/dashboard/WorkspaceNotice";
import { getWorkspace } from "@/lib/dashboard-auth";
import type { Workspace } from "@/lib/types/dashboard";
import { CreateStoreForm } from "./CreateStoreForm";

export const metadata: Metadata = { title: "Create your store" };

export default async function NewStorePage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("markaz-session")?.value;

  let workspace: Workspace;
  try {
    workspace = await getWorkspace(token);
  } catch (err) {
    return authFailureView(err);
  }

  return (
    <WorkspaceShell user={workspace.user}>
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
        {workspace.stores.length > 0 && (
          <Link
            href="/stores"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground no-underline hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" /> Back to your stores
          </Link>
        )}
        <PageHeader title="Create your store" description="Choose a name for your store. You can change it later." />
        <Surface variant="clay" level={3} radius="2xl" className="p-6">
          <CreateStoreForm />
        </Surface>
      </div>
    </WorkspaceShell>
  );
}
