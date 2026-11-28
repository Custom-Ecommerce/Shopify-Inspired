/*
 * A light tick under the finger when a control is pressed (Expo Go has expo-haptics). Never in the way: a phone without a vibrator, the web or a test
 * simply gets nothing.
 */
type Haptics = typeof import('expo-haptics');

let haptics: Haptics | null | undefined;

function load(): Haptics | null {
  if (haptics !== undefined) return haptics;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded on first use, so a missing native module cannot break a screen
    haptics = require('expo-haptics') as Haptics;
  } catch {
    haptics = null;
  }
  return haptics;
}

export function tapFeedback(): void {
  if (process.env.NODE_ENV === 'test') return;
  try {
    void load()
      ?.selectionAsync()
      .catch(() => undefined);
  } catch {
    // no haptics on this device
  }
}
