import { EmptyState, LoadingState } from '@markaz/mobile-kit';
import type { ReactNode } from 'react';
import { allows, type AdminTab } from '../access';
import { useAdminLevel } from '../services';

/** A screen opened from a link or a notification is checked too: the level may not have it. The server refuses in any case. */
export function Gate({ screen, children }: { screen: AdminTab; children: ReactNode }) {
  const level = useAdminLevel();
  if (level === null) return <LoadingState />;
  if (!allows(level, screen)) return <EmptyState title="Not available for your level" />;
  return <>{children}</>;
}
