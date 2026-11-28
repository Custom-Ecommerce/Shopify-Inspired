import { mobileDeviceListResponseSchema, mobileDeviceRevokeResponseSchema, type MobileDevice } from '@markaz/contracts/mobile';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import type { ApiClient } from '../core/api-client';
import { formatDateTime } from '../core/dates';
import { errorText } from '../core/errors';
import { useIsOnline } from '../native/network';
import { askFirst, type Confirm } from './confirm';
import { Smartphone } from './icons';
import { AppText, Button, Card, ErrorState, LoadingState, Notice, StatusBadge } from './primitives';

export interface DevicesCardProps {
  client: ApiClient;
  /** The app's devices route. */
  path: string;
  userId: string;
  confirm?: Confirm;
}

/** The phones signed in to the account; another one can be signed out. This one signs out with "Sign out". */
export function DevicesCard({ client, path, userId, confirm = askFirst }: DevicesCardProps) {
  const queryClient = useQueryClient();
  const online = useIsOnline();
  const queryKey = ['user', userId, 'devices'];
  const devices = useQuery({
    queryKey,
    queryFn: async () => (await client.request({ method: 'GET', path }, mobileDeviceListResponseSchema)).devices,
    enabled: userId !== '',
  });
  const [problem, setProblem] = useState<string | null>(null);

  const remove = (device: MobileDevice) => {
    confirm('Sign this phone out?', `${device.name} will have to sign in again.`, 'Sign it out', () => {
      setProblem(null);
      void client
        .request({ method: 'POST', path: `${path}/${encodeURIComponent(device.id)}/revoke` }, mobileDeviceRevokeResponseSchema)
        .then(() => queryClient.invalidateQueries({ queryKey }))
        .catch((error: unknown) => setProblem(errorText(error)));
    });
  };

  return (
    <Card title="My devices" icon={Smartphone}>
      {problem ? <Notice tone="danger" text={problem} /> : null}
      {!devices.data ? (
        devices.error ? (
          <ErrorState message={errorText(devices.error)} onRetry={() => void devices.refetch()} />
        ) : (
          <LoadingState rows={1} />
        )
      ) : (
        devices.data.map((device) => (
          <View key={device.id} style={{ gap: 4 }}>
            <AppText weight="medium">
              {device.name}
              {device.current ? ' (this phone)' : ''}
            </AppText>
            <AppText variant="caption" tone="muted">
              Version {device.appVersion}, last used {formatDateTime(device.lastSeenAt)}
            </AppText>
            {device.current ? <StatusBadge label="Signed in here" tone="success" /> : null}
            {device.current ? null : <Button title={`Sign out ${device.name}`} kind="outline" size="sm" block={false} onPress={() => remove(device)} disabled={!online} />}
          </View>
        ))
      )}
    </Card>
  );
}
