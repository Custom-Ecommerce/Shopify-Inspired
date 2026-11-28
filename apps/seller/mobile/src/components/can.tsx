import { sellerCan, type SellerCapability } from '@markaz/auth/seller-capabilities';
import { EmptyState, ShieldCheck } from '@markaz/mobile-kit';
import type { ReactNode } from 'react';
import { useStoreChoice } from '../services';

/** Whether the signed-in user's role in the chosen store allows it (the matrix of packages/auth; the server enforces it anyway). */
export function useCan(capability: SellerCapability): boolean {
  return sellerCan(useStoreChoice().store?.role, capability);
}

/** The app's RoleGate: its children only for a role that may, else `fallback`. */
export function Can({ capability, children, fallback = null }: { capability: SellerCapability; children: ReactNode; fallback?: ReactNode }) {
  return <>{useCan(capability) ? children : fallback}</>;
}

/** A whole screen the role does not have, for example opened from a link. */
export const NotForYourRole = () => <EmptyState icon={ShieldCheck} title="Not available for your role" text="Ask the store owner if you need this." />;
