import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

/**
 * "Online" means the phone has a network. Whether that network reaches the internet is not asked: a backend on the same Wi-Fi must work, and a request that
 * cannot get through fails on its own and keeps the change queued.
 */
export const isConnected = (state: { isConnected: boolean | null }): boolean => state.isConnected !== false;

let connected = false;

/** Tell TanStack Query about the network. Call once at start. */
export function connectNetworkState(): void {
  if (connected) return;
  connected = true;
  onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((state) => setOnline(isConnected(state))));
}

export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (listener) => onlineManager.subscribe(listener),
    () => onlineManager.isOnline(),
  );
}
