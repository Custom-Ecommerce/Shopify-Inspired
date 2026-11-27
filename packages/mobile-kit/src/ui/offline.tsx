import { Text, View } from 'react-native';
import { formatDateTime } from '../core/dates';
import { useIsOnline } from '../native/network';
import { Button, Notice, uiStyles } from './primitives';

/** Over a screen shown from the saved cache while there is no network: says so, and when the data was last refreshed. Nothing while online. */
export function OfflineBanner({ updatedAt }: { updatedAt?: number }) {
  if (useIsOnline()) return null;
  return <Notice text={updatedAt ? `Offline. Last refreshed ${formatDateTime(updatedAt)}.` : 'Offline.'} />;
}

/** A screen that was never opened before cannot be shown without a network. */
export function NoConnection({ onRetry }: { onRetry?: () => void }) {
  return (
    <View style={{ padding: 32, gap: 12, alignItems: 'center' }}>
      <Text accessibilityRole="header" style={uiStyles.title}>
        No connection
      </Text>
      <Text style={uiStyles.body}>This screen has not been opened on this phone yet. Connect to the internet to load it.</Text>
      {onRetry ? <Button title="Try again" kind="secondary" onPress={onRetry} /> : null}
    </View>
  );
}
