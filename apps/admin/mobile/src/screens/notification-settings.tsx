import { NotificationSettings } from '@markaz/mobile-kit';
import { PUSH_KIND_LABELS } from '../labels';
import { useServices, useUserId } from '../services';

export function NotificationSettingsScreen() {
  const { runtime, push } = useServices();
  return <NotificationSettings client={runtime.client} path="/api/admin/mobile/v1/push-settings" userId={useUserId()} availability={push.available()} labels={PUSH_KIND_LABELS} />;
}
