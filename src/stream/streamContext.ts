import { createContext, useContext, useSyncExternalStore } from 'react';
import type { StreamClient } from './streamClient.ts';

export const StreamContext = createContext<StreamClient | null>(null);

export function useStreamClient(): StreamClient {
  const client = useContext(StreamContext);
  if (!client) throw new Error('useStreamClient must be used inside <StreamProvider>');
  return client;
}

export function useConnectionStatus() {
  const client = useStreamClient();
  return useSyncExternalStore(client.subscribeStatus, client.getStatus);
}

export function useStreamStats() {
  const client = useStreamClient();
  return useSyncExternalStore(client.subscribeStats, client.getStats);
}
