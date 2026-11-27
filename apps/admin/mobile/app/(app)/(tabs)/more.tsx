import { useRouter, type Href } from 'expo-router';
import { MoreScreen } from '../../../src/screens/more';

export default function More() {
  const router = useRouter();
  return <MoreScreen onOpen={(screen) => router.push(`/${screen}` as Href)} onOpenNotificationSettings={() => router.push('/notifications' as Href)} />;
}
