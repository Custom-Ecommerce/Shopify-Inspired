import { useRouter, type Href } from 'expo-router';
import { useCallback } from 'react';
import { AlertsScreen } from '../../src/screens/alerts';

export default function Alerts() {
  const router = useRouter();
  const open = useCallback((path: string) => router.push(path as Href), [router]);
  return <AlertsScreen open={open} />;
}
