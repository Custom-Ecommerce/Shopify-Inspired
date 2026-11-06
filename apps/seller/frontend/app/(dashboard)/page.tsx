/**
 * `/` — the post-login resolver (Blueprint §6.2). Renders nothing: it always
 * redirects.
 *
 *   exactly one store AND MULTISTORE_IMPLICIT_DEFAULT on → /s/<id>
 *   anything else (0 stores, several stores, flag off)   → /stores
 *
 * With zero stores the portal shows its "No Stores Provisioned Yet" state.
 */

import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authFailureView } from "@/components/dashboard/WorkspaceNotice";
import { getWorkspace, isImplicitDefaultEnabled } from "@/lib/dashboard-auth";
import { storeBasePath } from "@/lib/store-routes";
import type { Workspace } from "@/lib/types/dashboard";

export default async function WorkspaceRootPage(): Promise<ReactNode> {
  const cookieStore = await cookies();
  const token = cookieStore.get("markaz-session")?.value;

  let workspace: Workspace;
  try {
    workspace = await getWorkspace(token);
  } catch (err) {
    return authFailureView(err);
  }

  const [onlyStore] = workspace.stores;
  if (workspace.stores.length === 1 && onlyStore && isImplicitDefaultEnabled()) {
    redirect(storeBasePath(onlyStore.id));
  }

  redirect("/stores");
}
