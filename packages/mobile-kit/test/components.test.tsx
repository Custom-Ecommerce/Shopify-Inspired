import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { themeFor } from '../src/theme';
import { Package } from '../src/ui/icons';
import { TabIcon, tab } from '../src/ui/navigation';
import {
  AppHeader,
  AppText,
  Banner,
  Button,
  Chip,
  ConfirmSheet,
  EmptyState,
  IconButton,
  ListRow,
  LoadingState,
  SearchField,
  StatCard,
  StatusBadge,
  SwitcherChip,
  TextField,
  Thumb,
} from '../src/ui/primitives';
import { FixedTheme, makeStyles, useTheme } from '../src/ui/theme-provider';

jest.mock('expo-secure-store', () => ({}));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => () => undefined) }));

const nothing = () => undefined;
const flat = (style: unknown) => StyleSheet.flatten(style as never) as Record<string, unknown>;

describe('S9-UI components', () => {
  it('states a stat card as one line for a screen reader, and opens its list', async () => {
    const open = jest.fn();
    await render(<StatCard icon={Package} label="Pending orders" value="4" tone="warning" onPress={open} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Pending orders: 4' }));
    expect(open).toHaveBeenCalled();
    await render(<StatCard icon={Package} label="Sales today" value="Rs 9,400" />);
    expect(screen.getByLabelText('Sales today: Rs 9,400')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a status as a word with a dot, never as colour alone', async () => {
    await render(<StatusBadge label="Pending" tone="warning" />);
    expect(screen.getByText('Pending')).toBeTruthy();
    expect(screen.getByLabelText('Pending')).toBeTruthy();
  });

  it('searches on the search key and clears with one tap', async () => {
    const change = jest.fn();
    const submit = jest.fn();
    await render(<SearchField label="Search products" value="shawl" onChangeText={change} onSubmit={submit} />);
    await fireEvent(screen.getByLabelText('Search products'), 'submitEditing');
    expect(submit).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Clear search' }));
    expect(change).toHaveBeenCalledWith('');
    await render(<SearchField label="Search products" value="" onChangeText={change} onSubmit={submit} />);
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  });

  it('shows and hides a password on request', async () => {
    await render(<TextField label="Password" value="secret" onChangeText={nothing} secureTextEntry revealable />);
    expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(false);
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeTruthy();
  });

  it('asks on a sheet, and Not now does nothing', async () => {
    const go = jest.fn();
    const cancel = jest.fn();
    await render(<ConfirmSheet visible title="Confirm order?" message="ORD-1 goes to Confirmed." confirmLabel="Yes, confirm order" onConfirm={go} onCancel={cancel} />);
    expect(screen.getByText('Confirm order?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
    expect([go.mock.calls.length, cancel.mock.calls.length]).toEqual([0, 1]);
    await fireEvent.press(screen.getByRole('button', { name: 'Yes, confirm order' }));
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('keeps every control at least 48 dp tall', async () => {
    await render(
      <>
        <Button title="Save" onPress={nothing} />
        <Chip label="COD" selected={false} onPress={nothing} />
        <IconButton icon={Package} label="Alerts" badge={3} onPress={nothing} />
        <SwitcherChip icon={Package} label="Demo Store" detail="Owner" onPress={nothing} />
      </>,
    );
    for (const control of screen.getAllByRole('button')) {
      const style = flat(typeof control.props.style === 'function' ? control.props.style({ pressed: false }) : control.props.style);
      expect(Math.max(Number(style.minHeight ?? 0), Number(style.height ?? 0))).toBeGreaterThanOrEqual(48);
    }
    expect(screen.getByRole('button', { name: 'Alerts, 3 unread' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Demo Store, Owner. Change store' })).toBeTruthy();
  });

  it('gives a list row its label and a header its back arrow', async () => {
    const open = jest.fn();
    const back = jest.fn();
    await render(
      <>
        <AppHeader title="Order" onBack={back} />
        <ListRow title="ORD-1" subtitle="Ayesha, Lahore" onPress={open} accessibilityLabel="Order ORD-1" />
      </>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Order ORD-1' }));
    expect([back.mock.calls.length, open.mock.calls.length]).toEqual([1, 1]);
    expect(screen.getByRole('header', { name: 'Order' })).toBeTruthy();
  });

  it('shows a picture fallback, an empty state with its action, a banner action, and skeletons while loading', async () => {
    const act = jest.fn();
    await render(
      <>
        <Thumb icon={Package} />
        <EmptyState title="No orders yet" text="Your first order will appear here." action={{ label: 'Try again', onPress: act }} />
        <Banner text="2 changes waiting to be sent" tone="info" action={{ label: 'View', onPress: act }} />
        <LoadingState rows={2} />
      </>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await fireEvent.press(screen.getByRole('button', { name: 'View' }));
    expect(act).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Loading')).toBeTruthy();
  });

  it('draws in the dark palette under a dark theme, from the same components', async () => {
    const dark = themeFor('markaz', 'dark', false);
    const useStyles = makeStyles((t) => ({ box: { backgroundColor: t.colors.card } }));
    function Probe() {
      const styles = useStyles();
      return <Text testID="probe" style={styles.box}>{useTheme().scheme}</Text>;
    }
    await render(
      <FixedTheme theme={dark}>
        <Probe />
        <AppText>Hello</AppText>
      </FixedTheme>,
    );
    expect(screen.getByText('dark')).toBeTruthy();
    expect(flat(screen.getByTestId('probe').props.style).backgroundColor).toBe(dark.colors.card);
    expect(flat(screen.getByText('Hello').props.style).color).toBe(dark.colors.foreground);
  });

  it('marks the open tab and labels each tab', async () => {
    const options = tab('Orders', Package);
    expect(options.title).toBe('Orders');
    await render(<>{options.tabBarLabel({ focused: true })}</>);
    expect(screen.getByText('Orders')).toBeTruthy();
    await render(<TabIcon icon={Package} focused />);
    expect(screen.toJSON()).toBeTruthy();
  });
});
