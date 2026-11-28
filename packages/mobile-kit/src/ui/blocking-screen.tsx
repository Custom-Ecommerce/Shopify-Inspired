import type { ReactNode } from 'react';
import { Modal, View } from 'react-native';
import { useTheme } from './theme-provider';

/**
 * A screen that must be answered before the app goes on (update the app, save the recovery codes). It lies over the navigator, which stays mounted:
 * taking the navigator away would lose where the user was. Android's back button does not close it.
 */
export function BlockingScreen({ visible, children }: { visible: boolean; children: ReactNode }) {
  const theme = useTheme();
  if (!visible) return null;
  return (
    <Modal visible animationType="none" onRequestClose={() => undefined}>
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>{children}</View>
    </Modal>
  );
}
