import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';

/*
 * Remote push, feature-detected (D-123): it needs an installed build. Expo Go cannot receive it, so there the notifications library is not even loaded and
 * the app says why. Nothing here logs the token. Which screen a notification opens is the app's own decision.
 */

export type PushAvailability = { ok: true } | { ok: false; reason: string };

export type PushRegistration = { ok: true; token: string } | { ok: false; reason: string };

export interface PushPort {
  available(): PushAvailability;
  /** Asks for permission and gets this phone's push token. */
  register(): Promise<PushRegistration>;
  /** Calls `handler` with the data of a tapped notification, also the one that opened the app. Returns a function that stops listening. */
  onTap(handler: (data: unknown) => void): () => void;
}

function projectId(): string | null {
  const fromExtra = (Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined)?.eas?.projectId;
  const value = fromExtra ?? (Constants as { easConfig?: { projectId?: unknown } | null }).easConfig?.projectId;
  return typeof value === 'string' && value !== '' ? value : null;
}

type NotificationsModule = typeof import('expo-notifications');

export function createPhonePush(inExpoGo: () => boolean = isRunningInExpoGo, channelName: string = 'Orders and alerts'): PushPort {
  let loaded: NotificationsModule | null = null;
  function library(): NotificationsModule | null {
    if (inExpoGo()) return null;
    if (!loaded) {
      try {
        // Loaded only here: importing it inside Expo Go fails on Android.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        loaded = require('expo-notifications') as NotificationsModule;
        loaded.setNotificationHandler({
          handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
        });
      } catch {
        loaded = null;
      }
    }
    return loaded;
  }

  const available = (): PushAvailability => {
    if (inExpoGo()) return { ok: false, reason: 'Expo Go cannot receive push notifications. The installed app can.' };
    if (!projectId()) return { ok: false, reason: 'This build is not set up for push notifications yet.' };
    return library() ? { ok: true } : { ok: false, reason: 'Push notifications are not available on this phone.' };
  };

  return {
    available,

    async register() {
      const can = available();
      if (!can.ok) return can;
      const notifications = library()!;
      try {
        await notifications.setNotificationChannelAsync('default', { name: channelName, importance: notifications.AndroidImportance.HIGH });
        let permission = await notifications.getPermissionsAsync();
        if (!permission.granted) permission = await notifications.requestPermissionsAsync();
        if (!permission.granted) return { ok: false, reason: 'Notifications are turned off for this app in the phone settings.' };
        const token = await notifications.getExpoPushTokenAsync({ projectId: projectId()! });
        return { ok: true, token: token.data };
      } catch {
        return { ok: false, reason: 'This phone could not be registered for notifications.' };
      }
    },

    onTap(handler) {
      const notifications = library();
      if (!notifications) return () => undefined;
      const seen = new Set<string>();
      const take = (response: { notification: { request: { identifier: string; content: { data?: unknown } } } } | null) => {
        if (!response) return;
        const { identifier, content } = response.notification.request;
        if (seen.has(identifier)) return;
        seen.add(identifier);
        handler(content.data);
      };
      void Promise.resolve(notifications.getLastNotificationResponseAsync())
        .then(take)
        .catch(() => undefined);
      const subscription = notifications.addNotificationResponseReceivedListener(take);
      return () => subscription.remove();
    },
  };
}
