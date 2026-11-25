import { auditActorOf } from '@/lib/auth';
import type { AuthContext } from '@/lib/auth';
import { domainTargets, toDomainState, type DomainStateWire, type DomainStoreFields } from '@/lib/domain-service';
import { getVercelDomains } from '@/lib/domain-vercel';
import { planAllowsCustomDomain } from '@/lib/plan';
import { writeAuditLog } from '@/lib/services';

/** What the domain routes read of a store. The token is not selected by default, so it is asked for here. */
export const DOMAIN_SELECT = 'name slug status owner domain customDomainStatus +domainToken domainCheckedAt domainFailureReason storefront updatedAt';

export type DomainStoreDoc = DomainStoreFields & { _id: unknown; owner?: unknown; storefront?: unknown; updatedAt?: unknown };

/** The answer every domain route gives, for the store as it is now. */
export async function domainStateOf(doc: DomainStoreDoc | null, ctx: AuthContext): Promise<DomainStateWire> {
  return toDomainState(doc, {
    vercelConfigured: getVercelDomains().configured,
    planAllowsCustomDomain: await planAllowsCustomDomain(ctx.userId),
    targets: domainTargets(),
  });
}

/** Best effort: a failed audit entry never fails the write that already happened. */
export async function auditDomain(action: string, storeId: string, ctx: AuthContext, details: Record<string, unknown>): Promise<void> {
  try {
    await writeAuditLog(action, 'store', storeId, auditActorOf(ctx), details);
  } catch (err) {
    console.error('[seller-backend] could not write the domain audit entry', err instanceof Error ? err.message : 'unknown');
  }
}
