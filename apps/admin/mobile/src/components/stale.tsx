import { formatDateTime, Notice, useIsOnline } from '@markaz/mobile-kit';
import { errorText } from '@markaz/mobile-kit/core';

/** T02: a clear label whenever what is on screen is not fresh from the server. Nothing when it is. */
export function StaleLabel({ updatedAt, error }: { updatedAt: number; error: unknown }) {
  const online = useIsOnline();
  if (!online) return <Notice text={`Offline. This is saved data from ${formatDateTime(updatedAt)} and may be out of date.`} />;
  if (error) return <Notice text={`This is saved data from ${formatDateTime(updatedAt)}. ${errorText(error)}`} />;
  return null;
}
