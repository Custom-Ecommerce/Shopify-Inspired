import { Linking } from 'react-native';
import type { UpgradeNotice } from '../core/runtime';
import { RefreshCw } from './icons';
import { AppText, Button, EmptyState, ScrollScreen } from './primitives';

/** 426: this version is too old. The session is kept: after the update the app opens where it was. */
export function UpgradeScreen({ notice, open = (url: string) => void Linking.openURL(url) }: { notice: UpgradeNotice; open?: (url: string) => void }) {
  const url = notice.storeUrl;
  return (
    <ScrollScreen>
      <EmptyState icon={RefreshCw} title="Update the app" />
      <AppText style={{ textAlign: 'center' }}>
        This version is too old to use.{notice.minVersion ? ` Version ${notice.minVersion} or newer is needed.` : ''}
      </AppText>
      {url && url.startsWith('https://') ? <Button title="Open the Play Store" onPress={() => open(url)} /> : null}
    </ScrollScreen>
  );
}
