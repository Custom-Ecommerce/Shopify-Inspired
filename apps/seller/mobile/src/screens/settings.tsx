import { askFirst, Button, Card, DevicesCard, OfflineBanner, Row, ScrollScreen, uiStyles, useSessionState, type Confirm } from '@markaz/mobile-kit';
import { MOBILE_V1 } from '@markaz/mobile-kit/core';
import { Linking, Text } from 'react-native';
import { QueueNotice } from '../components/queue-notice';
import { roleLabel } from '../labels';
import { startupMillis } from '../perf';
import { useServices, useStoreChoice, useUserId } from '../services';

export interface SettingsProps {
  onOpenNotificationSettings: () => void;
  onSwitchStore: () => void;
  onOpenAlerts: () => void;
  onOpenPending: () => void;
  confirm?: Confirm;
  openLink?: (url: string) => void;
}

/** The account, its phones, the app and help. Nothing about the store is changed here: that stays on the website. */
export function SettingsScreen({ onOpenNotificationSettings, onSwitchStore, onOpenAlerts, onOpenPending, confirm = askFirst, openLink = (url) => void Linking.openURL(url) }: SettingsProps) {
  const { runtime, appVersion, portalUrl } = useServices();
  const user = useSessionState(runtime).user;
  const userId = useUserId();
  const { store } = useStoreChoice();
  const startup = startupMillis();

  const signOut = () => {
    const waiting = runtime.queue()?.list().length ?? 0;
    const message = waiting
      ? `${waiting} ${waiting === 1 ? 'change has' : 'changes have'} not been sent yet and will be lost.`
      : 'The saved shop data is removed from this phone.';
    confirm('Sign out?', message, 'Sign out', () => void runtime.session.signOut());
  };

  const support = portalUrl && store ? `${portalUrl}/s/${store.id}/support` : null;

  return (
    <ScrollScreen>
      <OfflineBanner />
      <QueueNotice onOpen={onOpenPending} />
      <Card title="Account">
        <Row label="Name" value={user?.name ?? '-'} />
        <Row label="Email" value={user?.email ?? '-'} />
        {store ? <Row label="Store" value={store.name} /> : null}
        {store ? <Row label="Role" value={roleLabel(store.role)} /> : null}
        <Button title="Switch store" kind="secondary" onPress={onSwitchStore} />
        <Button title="Alerts" kind="secondary" onPress={onOpenAlerts} />
        <Button title="Pending changes" kind="secondary" onPress={onOpenPending} />
        <Button title="Notification settings" kind="secondary" onPress={onOpenNotificationSettings} />
        <Text style={uiStyles.muted}>Password, email and store settings are changed on the website.</Text>
      </Card>

      <DevicesCard client={runtime.client} path={`${MOBILE_V1}/devices`} userId={userId} confirm={confirm} />

      <Card title="Help">
        {support ? <Button title="Contact support" kind="secondary" onPress={() => openLink(support)} /> : <Text style={uiStyles.body}>Contact support from the website, under Support.</Text>}
        <Row label="App version" value={appVersion} />
        {startup !== null ? <Row label="Last start to first screen" value={`${(startup / 1000).toFixed(1)} s`} /> : null}
      </Card>

      <Button title="Sign out" kind="danger" onPress={signOut} />
    </ScrollScreen>
  );
}
