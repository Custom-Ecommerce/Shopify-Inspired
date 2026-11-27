import { mobilePushSettingsSchema, mobileQuietHoursSchema, type MobilePushSettings } from '@markaz/contracts/mobile';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import type { ApiClient } from '../core/api-client';
import { errorText } from '../core/errors';
import { useIsOnline } from '../native/network';
import type { PushAvailability } from '../native/push';
import { MIN_TAP_TARGET, spacing } from '../theme';
import { NoConnection } from './offline';
import { Button, Card, ErrorState, LoadingState, Notice, ScrollScreen, TextField, uiStyles } from './primitives';

type Update = Partial<Pick<MobilePushSettings, 'muted' | 'mutedKinds' | 'quietHours'>>;

function Toggle({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <View style={styles.toggle}>
      <Text style={[uiStyles.body, styles.toggleLabel]}>{label}</Text>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange} disabled={disabled} />
    </View>
  );
}

const DEFAULT_QUIET = { start: '22:00', end: '08:00' };

export interface NotificationSettingsProps {
  client: ApiClient;
  /** The app's push-settings route. */
  path: string;
  userId: string;
  availability: PushAvailability;
  labels: Record<string, string>;
}

/** Mute all, mute a kind, quiet hours: the same for both apps. Changing them needs the network. */
export function NotificationSettings({ client, path, userId, availability, labels }: NotificationSettingsProps) {
  const queryClient = useQueryClient();
  const online = useIsOnline();
  const queryKey = ['user', userId, 'push-settings'];
  const settings = useQuery({ queryKey, queryFn: () => client.request<MobilePushSettings>({ method: 'GET', path }, mobilePushSettingsSchema) });
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [typed, setTyped] = useState<{ start: string; end: string } | null>(null);

  const data = settings.data;
  if (!data && !online) return <NoConnection onRetry={() => void settings.refetch()} />;
  if (!data) return settings.error ? <ErrorState message={errorText(settings.error)} onRetry={() => void settings.refetch()} /> : <LoadingState />;

  async function save(update: Update) {
    setSaving(true);
    setProblem(null);
    try {
      queryClient.setQueryData(queryKey, await client.request<MobilePushSettings>({ method: 'PATCH', path, body: update }, mobilePushSettingsSchema));
      setTyped(null);
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  const quiet = data.quietHours ?? null;
  const hours = typed ?? quiet ?? DEFAULT_QUIET;
  const saveHours = () => {
    const checked = mobileQuietHoursSchema.safeParse(hours);
    if (!checked.success) {
      setProblem('Write both times as HH:MM, for example 22:00 and 08:00. They must differ.');
      return;
    }
    void save({ quietHours: checked.data });
  };
  const off = saving || !online;

  return (
    <ScrollScreen refreshing={settings.isRefetching} onRefresh={() => void settings.refetch()}>
      {!availability.ok ? <Notice text={availability.reason} /> : null}
      {!online ? <Notice text="Changing notification settings needs a connection." /> : null}
      {problem ? <Notice tone="danger" text={problem} /> : null}
      <Card title="Notifications">
        <Toggle label="Mute all notifications" value={data.muted} onChange={(muted) => void save({ muted })} disabled={off} />
        {data.kinds.map((kind) => (
          <Toggle
            key={kind}
            label={labels[kind] ?? kind}
            value={!data.muted && !data.mutedKinds.includes(kind)}
            disabled={off || data.muted}
            onChange={(on) =>
              void save({ mutedKinds: (on ? data.mutedKinds.filter((entry) => entry !== kind) : [...data.mutedKinds, kind]) as MobilePushSettings['mutedKinds'] })
            }
          />
        ))}
      </Card>
      <Card title="Quiet hours">
        <Text style={uiStyles.muted}>No notifications are sent between these times (Pakistan time). Everything still appears in the app.</Text>
        <Toggle label="Use quiet hours" value={quiet !== null} disabled={off} onChange={(on) => void save({ quietHours: on ? DEFAULT_QUIET : null })} />
        {quiet ? (
          <>
            <TextField label="From (HH:MM)" value={hours.start} onChangeText={(start) => setTyped({ ...hours, start })} keyboardType="numbers-and-punctuation" maxLength={5} />
            <TextField label="To (HH:MM)" value={hours.end} onChangeText={(end) => setTyped({ ...hours, end })} keyboardType="numbers-and-punctuation" maxLength={5} />
            <Button title="Save quiet hours" kind="secondary" onPress={saveHours} busy={saving} disabled={!online} />
          </>
        ) : null}
      </Card>
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  toggle: { minHeight: MIN_TAP_TARGET, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  toggleLabel: { flex: 1 },
});
