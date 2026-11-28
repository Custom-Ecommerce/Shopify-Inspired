import { LEVEL_LABELS } from '@markaz/auth/admin-levels';
import {
  askFirst,
  Bell,
  Button,
  Card,
  type Confirm,
  DevicesCard,
  Icon,
  ListRow,
  LogOut,
  RefreshCw,
  Row,
  ScrollScreen,
  UserCog,
  Users,
  useSessionState,
} from '@markaz/mobile-kit';
import { moreFor, type AdminTab } from '../access';
import { useAdminLevel, useServices, useUserId } from '../services';

const TITLES: Partial<Record<AdminTab, string>> = { sellers: 'Sellers', sync: 'Sync' };
const ICONS: Partial<Record<AdminTab, typeof Users>> = { sellers: Users, sync: RefreshCw };

export function MoreScreen({ onOpen, onOpenNotificationSettings, confirm = askFirst }: { onOpen: (screen: AdminTab) => void; onOpenNotificationSettings: () => void; confirm?: Confirm }) {
  const { runtime, appVersion } = useServices();
  const user = useSessionState(runtime).user;
  const userId = useUserId();
  const level = useAdminLevel();

  return (
    <ScrollScreen>
      {moreFor(level).map((screen) => (
        <ListRow key={screen} leading={<Icon icon={ICONS[screen] ?? Users} tone="muted" />} title={TITLES[screen] ?? screen} onPress={() => onOpen(screen)} />
      ))}
      <ListRow leading={<Icon icon={Bell} tone="muted" />} title="Notification settings" onPress={onOpenNotificationSettings} />
      <Card title="Account" icon={UserCog}>
        <Row label="Name" value={user?.name ?? '-'} />
        <Row label="Email" value={user?.email ?? '-'} />
        <Row label="Level" value={level ? LEVEL_LABELS[level] : '-'} />
        <Row label="App version" value={appVersion} />
      </Card>
      <DevicesCard client={runtime.client} path="/api/admin/mobile/v1/devices" userId={userId} confirm={confirm} />
      <Button
        title="Sign out"
        kind="destructive"
        icon={LogOut}
        onPress={() => confirm('Sign out?', 'The saved numbers are removed from this phone.', 'Sign out', () => void runtime.session.signOut())}
      />
    </ScrollScreen>
  );
}
