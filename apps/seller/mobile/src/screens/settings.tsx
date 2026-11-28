import {
  AppText,
  askFirst,
  Bell,
  Button,
  Card,
  Clock,
  DevicesCard,
  LifeBuoy,
  ListRow,
  LogOut,
  OfflineBanner,
  Icon,
  Row,
  ScrollScreen,
  SectionHeader,
  Store,
  UserCog,
  useSessionState,
  type Confirm,
  type IconComponent,
} from '@markaz/mobile-kit';
import { MOBILE_V1 } from '@markaz/mobile-kit/core';
import { Linking } from 'react-native';
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
      <Card title="Account" icon={UserCog}>
        <Row label="Name" value={user?.name ?? '-'} />
        <Row label="Email" value={user?.email ?? '-'} />
        {store ? <Row label="Store" value={store.name} /> : null}
        {store ? <Row label="Role" value={roleLabel(store.role)} /> : null}
        <AppText variant="caption" tone="muted">
          Password, email and store settings are changed on the website.
        </AppText>
      </Card>

      <SectionHeader title="This app" />
      <MenuRow icon={Store} title="Switch store" onPress={onSwitchStore} />
      <MenuRow icon={Bell} title="Alerts" onPress={onOpenAlerts} />
      <MenuRow icon={Clock} title="Pending changes" onPress={onOpenPending} />
      <MenuRow icon={Bell} title="Notification settings" onPress={onOpenNotificationSettings} />

      <DevicesCard client={runtime.client} path={`${MOBILE_V1}/devices`} userId={userId} confirm={confirm} />

      <Card title="Help" icon={LifeBuoy}>
        {support ? <Button title="Contact support" kind="outline" icon={LifeBuoy} onPress={() => openLink(support)} /> : <AppText>Contact support from the website, under Support.</AppText>}
        <Row label="App version" value={appVersion} />
        {startup !== null ? <Row label="Last start to first screen" value={`${(startup / 1000).toFixed(1)} s`} /> : null}
      </Card>

      <Button title="Sign out" kind="destructive" icon={LogOut} onPress={signOut} />
    </ScrollScreen>
  );
}

/** One entry of the settings menu: an icon, its name, a chevron. */
function MenuRow({ icon, title, onPress }: { icon: IconComponent; title: string; onPress: () => void }) {
  return <ListRow leading={<Icon icon={icon} size="md" tone="muted" />} title={title} onPress={onPress} />;
}
