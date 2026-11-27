import { useRouter, type Href } from 'expo-router';
import { SettingsScreen } from '../../../src/screens/settings';

export default function Settings() {
  const router = useRouter();
  return (
    <SettingsScreen
      onOpenNotificationSettings={() => router.push('/notifications' as Href)}
      onSwitchStore={() => router.push('/stores' as Href)}
      onOpenAlerts={() => router.push('/alerts' as Href)}
      onOpenPending={() => router.push('/pending' as Href)}
    />
  );
}
