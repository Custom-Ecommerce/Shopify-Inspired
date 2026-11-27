import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsRestoring, useQuery } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { formatDateTime } from '../src/core/dates';
import { CACHE_BUSTER, cacheStorageKey } from '../src/core/offline/cache';
import { QueryProvider } from '../src/native/providers';
import { createQueryClient } from '../src/native/query';
import { Button, Chip, ErrorState, TextField } from '../src/ui/primitives';
import { UpgradeScreen } from '../src/ui/upgrade-screen';
import { BlockingScreen } from '../src/ui/blocking-screen';

jest.mock('expo-secure-store', () => ({}));
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a jest.mock factory cannot use an import
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => () => undefined) }));

describe('shared screens and controls', () => {
  it('asks for an update with the store link, and opens only an https link', async () => {
    const open = jest.fn();
    await render(<UpgradeScreen notice={{ minVersion: '2.0.0', storeUrl: 'https://play.google.com/store/apps/details?id=x' }} open={open} />);
    expect(screen.getByText(/Version 2.0.0 or newer/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Open the Play Store' }));
    expect(open).toHaveBeenCalledWith('https://play.google.com/store/apps/details?id=x');
    await render(<UpgradeScreen notice={{ minVersion: null, storeUrl: 'intent://evil' }} open={open} />);
    expect(screen.queryByRole('button', { name: 'Open the Play Store' })).toBeNull();
  });

  it('does not press a busy or disabled button, and labels its fields', async () => {
    const press = jest.fn();
    await render(
      <>
        <Button title="Save" onPress={press} busy />
        <Button title="Send" onPress={press} disabled />
        <Chip label="COD" selected onPress={press} />
        <TextField label="Email" value="" onChangeText={() => undefined} error="Enter an email." />
        <ErrorState message="Down" onRetry={press} />
      </>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(press).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByText('Enter an email.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(press).toHaveBeenCalledTimes(1);
  });

  it('lays a screen that must be answered over what is there, which stays mounted', async () => {
    let mounts = 0;
    function Below() {
      useEffect(() => {
        mounts += 1;
      }, []);
      return <Text>below</Text>;
    }
    const Page = ({ blocked }: { blocked: boolean }) => (
      <>
        <Below />
        <BlockingScreen visible={blocked}>
          <Text>answer me</Text>
        </BlockingScreen>
      </>
    );
    const view = await render(<Page blocked={false} />);
    expect(screen.queryByText('answer me')).toBeNull();
    await view.rerender(<Page blocked />);
    expect(screen.getByText('answer me')).toBeTruthy();
    expect(screen.getByText('below', { includeHiddenElements: true })).toBeTruthy();
    await view.rerender(<Page blocked={false} />);
    expect(screen.queryByText('answer me')).toBeNull();
    expect(mounts).toBe(1);
  });

  it('writes dates the same way on every phone', () => {
    const now = new Date(2026, 10, 26);
    expect(formatDateTime(new Date(2026, 10, 26, 15, 5).toISOString(), now)).toBe('26 Nov, 3:05 pm');
    expect(formatDateTime(new Date(2025, 0, 2, 0, 0).toISOString(), now)).toBe('2 Jan 2025, 12:00 am');
    expect(formatDateTime(null, now)).toBe('-');
    expect(formatDateTime('not a date', now)).toBe('-');
  });
});

describe('query provider', () => {
  function Probe() {
    const restoring = useIsRestoring();
    const query = useQuery({ queryKey: ['user', 'u1', 'hello'], queryFn: () => new Promise<string>(() => undefined) });
    return <Text>{restoring ? 'restoring' : (query.data ?? 'nothing yet')}</Text>;
  }

  it('shows what was saved for the signed-in user, and nothing of it to someone else', async () => {
    const saved = {
      buster: CACHE_BUSTER,
      timestamp: Date.now(),
      clientState: {
        mutations: [],
        queries: [
          {
            queryKey: ['user', 'u1', 'hello'],
            queryHash: '["user","u1","hello"]',
            state: { data: 'saved orders', dataUpdatedAt: Date.now(), status: 'success', fetchStatus: 'idle' },
          },
        ],
      },
    };
    await AsyncStorage.setItem(cacheStorageKey('u1'), JSON.stringify(saved));
    const client = createQueryClient();
    const view = await render(
      <QueryProvider client={client} userId="u1">
        <Probe />
      </QueryProvider>,
    );
    await waitFor(() => expect(screen.getByText('saved orders')).toBeTruthy());
    await view.unmount();
    client.clear();

    const other = createQueryClient();
    await render(
      <QueryProvider client={other} userId="u2">
        <Probe />
      </QueryProvider>,
    );
    await waitFor(() => expect(screen.getByText('nothing yet')).toBeTruthy());
    other.clear();
  });
});
