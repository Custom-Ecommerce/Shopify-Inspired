import {
  BlockingScreen,
  connectNetworkState,
  createPhonePush,
  createPhoneRuntime,
  createQueryClient,
  ErrorState,
  LoadingState,
  phoneStore,
  QueryProvider,
  UpgradeScreen,
  useSessionState,
  useUpgradeNotice,
} from '@markaz/mobile-kit';
import type { QueryClient } from '@tanstack/react-query';
import { isRunningInExpoGo } from 'expo';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { apiUrl, appVersion } from '../src/config';
import { RecoveryCodesScreen } from '../src/screens/recovery-codes';
import { createRecoveryHolder, ServicesProvider, shouldPersistAdmin, type Services } from '../src/services';

connectNetworkState();

const deviceName = (): string => (Platform.constants as { Model?: string }).Model?.slice(0, 80) || 'Android phone';

function createServices(baseUrl: string, queryClient: QueryClient): Services {
  return {
    runtime: createPhoneRuntime({ app: 'admin', baseUrl, appVersion, queryClient }),
    storage: phoneStore,
    appVersion,
    deviceName: deviceName(),
    push: createPhonePush(isRunningInExpoGo, 'Admin alerts'),
    recovery: createRecoveryHolder(),
  };
}

function App({ baseUrl }: { baseUrl: string }) {
  const [queryClient] = useState(createQueryClient);
  const [services] = useState(() => createServices(baseUrl, queryClient));
  const session = useSessionState(services.runtime);
  const upgrade = useUpgradeNotice(services.runtime);
  const codes = useSyncExternalStore(services.recovery.subscribe, services.recovery.get);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    void services.runtime.session
      .restore()
      .catch(() => undefined)
      .then(() => setRestored(true));
  }, [services]);

  if (!restored) return <LoadingState />;

  const signedIn = session.status === 'signed_in';
  return (
    <ServicesProvider value={services}>
      <QueryProvider client={queryClient} userId={session.user?.id ?? null} shouldPersist={shouldPersistAdmin}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(app)" />
          </Stack.Protected>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="sign-in" />
          </Stack.Protected>
        </Stack>
        {/* Over the navigator, not instead of it. */}
        <BlockingScreen visible={upgrade !== null || codes !== null}>
          {upgrade ? (
            <UpgradeScreen notice={upgrade} />
          ) : codes ? (
            <SafeAreaView style={{ flex: 1 }}>
              <RecoveryCodesScreen codes={codes} onSaved={() => services.recovery.set(null)} />
            </SafeAreaView>
          ) : null}
        </BlockingScreen>
      </QueryProvider>
    </ServicesProvider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {apiUrl.ok ? <App baseUrl={apiUrl.url} /> : <ErrorState message={apiUrl.problem} />}
    </SafeAreaProvider>
  );
}
