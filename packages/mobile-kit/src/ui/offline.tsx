import { formatDateTime } from '../core/dates';
import { useIsOnline } from '../native/network';
import { WifiOff } from './icons';
import { Banner, EmptyState } from './primitives';

/** Over a screen shown from the saved cache while there is no network: says so, and when the data was last refreshed. Nothing while online. */
export function OfflineBanner({ updatedAt }: { updatedAt?: number }) {
  if (useIsOnline()) return null;
  return <Banner tone="offline" text={updatedAt ? `Offline. Last refreshed ${formatDateTime(updatedAt)}.` : 'Offline.'} />;
}

/** A screen that was never opened before cannot be shown without a network. */
export function NoConnection({ onRetry }: { onRetry?: () => void }) {
  return (
    <EmptyState
      icon={WifiOff}
      title="No connection"
      text="This screen has not been opened on this phone yet. Connect to the internet to load it."
      action={onRetry ? { label: 'Try again', onPress: onRetry } : undefined}
    />
  );
}
