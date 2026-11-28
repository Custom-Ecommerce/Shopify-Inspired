import { NotificationSettings } from '@markaz/mobile-kit';
import { MOBILE_V1 } from '@markaz/mobile-kit/core';
import { PUSH_KIND_LABELS } from '../labels';
import { useServices, useUserId } from '../services';

export function NotificationSettingsScreen() {
  const { runtime, push } = useServices();
  return <NotificationSettings client={runtime.client} path={`${MOBILE_V1}/push-settings`} userId={useUserId()} availability={push.available()} labels={PUSH_KIND_LABELS} />;
}
