import { act, screen } from '@testing-library/react-native';
import { router, Stack, type Href } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';
import TabsLayout from '../app/(app)/(tabs)/_layout';

let mockLevel = 'owner';
jest.mock('../src/services', () => ({ useAdminLevel: () => mockLevel }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.0.0' } } }));

const page = (name: string) =>
  function Page() {
    return <Text>{`${name} screen`}</Text>;
  };

const routes = {
  _layout: () => <Stack screenOptions={{ headerShown: false }} />,
  '(app)/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
  '(app)/(tabs)/_layout': TabsLayout,
  '(app)/(tabs)/index': page('overview'),
  '(app)/(tabs)/orders': page('orders'),
  '(app)/(tabs)/payments': page('payments'),
  '(app)/(tabs)/tickets': page('tickets'),
  '(app)/(tabs)/sellers': page('sellers'),
  '(app)/(tabs)/sync': page('sync'),
  '(app)/(tabs)/more': page('more'),
};

const tabButton = (title: string) => screen.queryByRole('tab', { name: new RegExp(title) });

describe('screens under More', () => {
  it.each([
    ['owner', 'sellers', ['Overview', 'Orders', 'Payments', 'Tickets', 'More'], ['Sellers', 'Sync']],
    ['owner', 'sync', ['Overview', 'Orders', 'Payments', 'Tickets', 'More'], ['Sellers', 'Sync']],
    ['customer_support', 'sellers', ['Orders', 'Tickets', 'More'], ['Overview', 'Payments', 'Sellers', 'Sync']],
  ] as const)('%s opens %s, which has no tab button', async (level, name, shown, hidden) => {
    mockLevel = level;
    await renderRouter(routes, { initialUrl: '/more' });
    for (const title of shown) expect(tabButton(title)).not.toBeNull();
    for (const title of hidden) expect(tabButton(title)).toBeNull();
    await act(async () => router.push(`/${name}` as Href));
    expect(screen).toHavePathname(`/${name}`);
    expect(screen.getByText(`${name} screen`)).toBeTruthy();
  });
});
