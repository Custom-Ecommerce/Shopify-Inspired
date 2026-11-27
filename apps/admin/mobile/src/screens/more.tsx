import { LEVEL_LABELS } from '@markaz/auth/admin-levels';
import { askFirst, Button, Card, DevicesCard, Row, ScrollScreen, useSessionState, type Confirm } from '@markaz/mobile-kit';
import { moreFor, type AdminTab } from '../access';
import { useAdminLevel, useServices, useUserId } from '../services';

const TITLES: Partial<Record<AdminTab, string>> = { sellers: 'Sellers', sync: 'Sync' };

export function MoreScreen({ onOpen, onOpenNotificationSettings, confirm = askFirst }: { onOpen: (screen: AdminTab) => void; onOpenNotificationSettings: () => void; confirm?: Confirm }) {
  const { runtime, appVersion } = useServices();
  const user = useSessionState(runtime).user;
  const userId = useUserId();
  const level = useAdminLevel();

  return (
    <ScrollScreen>
      {moreFor(level).map((screen) => (
        <Button key={screen} title={TITLES[screen] ?? screen} kind="secondary" onPress={() => onOpen(screen)} />
      ))}
      <Card title="Account">
        <Row label="Name" value={user?.name ?? '-'} />
        <Row label="Email" value={user?.email ?? '-'} />
        <Row label="Level" value={level ? LEVEL_LABELS[level] : '-'} />
        <Button title="Notification settings" kind="secondary" onPress={onOpenNotificationSettings} />
        <Row label="App version" value={appVersion} />
      </Card>
      <DevicesCard client={runtime.client} path="/api/admin/mobile/v1/devices" userId={userId} confirm={confirm} />
      <Button
        title="Sign out"
        kind="danger"
        onPress={() => confirm('Sign out?', 'The saved numbers are removed from this phone.', 'Sign out', () => void runtime.session.signOut())}
      />
    </ScrollScreen>
  );
}
