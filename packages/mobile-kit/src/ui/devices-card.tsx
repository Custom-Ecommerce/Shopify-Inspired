import { mobileDeviceListResponseSchema, mobileDeviceRevokeResponseSchema, type MobileDevice } from '@markaz/contracts/mobile';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Text, View } from 'react-native';
import type { ApiClient } from '../core/api-client';
import { formatDateTime } from '../core/dates';
import { errorText } from '../core/errors';
import { useIsOnline } from '../native/network';
import { askFirst, type Confirm } from './confirm';
import { Button, Card, ErrorState, LoadingState, Notice, uiStyles } from './primitives';

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
    <Card title="My devices">
      {problem ? <Notice tone="danger" text={problem} /> : null}
      {!devices.data ? (
        devices.error ? (
          <ErrorState message={errorText(devices.error)} onRetry={() => void devices.refetch()} />
        ) : (
          <LoadingState rows={1} />
        )
      ) : (
        devices.data.map((device) => (
          <View key={device.id}>
            <Text style={uiStyles.body}>
              {device.name}
              {device.current ? ' (this phone)' : ''}
            </Text>
            <Text style={uiStyles.muted}>
              Version {device.appVersion}, last used {formatDateTime(device.lastSeenAt)}
            </Text>
            {device.current ? null : <Button title={`Sign out ${device.name}`} kind="secondary" onPress={() => remove(device)} disabled={!online} />}
          </View>
        ))
      )}
    </Card>
  );
}
