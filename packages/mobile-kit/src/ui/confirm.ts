import { Alert } from 'react-native';

/** Asks before something that cannot be taken back. A test passes its own. */
export type Confirm = (title: string, message: string, action: string, run: () => void) => void;

export const askFirst: Confirm = (title, message, action, run) =>
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: action, style: 'destructive', onPress: run },
  ]);
