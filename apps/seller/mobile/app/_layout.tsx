import {
  BlockingScreen,
  connectNetworkState,
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
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { apiUrl, appVersion, portalUrl } from '../src/config';
import { createPhonePush } from '../src/push';
import { ServicesProvider, type Services } from '../src/services';

connectNetworkState();

const deviceName = (): string => (Platform.constants as { Model?: string }).Model?.slice(0, 80) || 'Android phone';

function createServices(baseUrl: string, queryClient: QueryClient): Services {
  return {
    runtime: createPhoneRuntime({ app: 'seller', baseUrl, appVersion, queryClient }),
    storage: phoneStore,
    appVersion,
    deviceName: deviceName(),
    portalUrl,
    push: createPhonePush(),
  };
}

function App({ baseUrl }: { baseUrl: string }) {
  const [queryClient] = useState(createQueryClient);
  const [services] = useState(() => createServices(baseUrl, queryClient));
  const session = useSessionState(services.runtime);
  const upgrade = useUpgradeNotice(services.runtime);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    // The stored session is read without a network, so the app opens offline too.
    void services.runtime.session
      .restore()
      .catch(() => undefined)
      .then(() => setRestored(true));
  }, [services]);

  if (!restored) return <LoadingState />;

  const signedIn = session.status === 'signed_in';
  return (
    <ServicesProvider value={services}>
      <QueryProvider client={queryClient} userId={session.user?.id ?? null}>
        {/* Signed out (also a revoked device): the shop's screens are gone from the navigator, whatever route was open. */}
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(app)" />
          </Stack.Protected>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="sign-in" />
          </Stack.Protected>
        </Stack>
        <BlockingScreen visible={upgrade !== null}>{upgrade ? <UpgradeScreen notice={upgrade} /> : null}</BlockingScreen>
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
