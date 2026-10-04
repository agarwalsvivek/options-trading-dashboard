import { useEffect, useState, type ReactNode } from 'react';
import { createStreamClient } from './streamClient.ts';
import { StreamContext } from './streamContext.ts';

const STREAM_URL = import.meta.env.VITE_STREAM_URL ?? 'ws://localhost:9999';

// One stream connection for the whole app; children subscribe through the hooks in streamContext.ts
export function StreamProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createStreamClient);

  useEffect(() => {
    client.connect(STREAM_URL);
    return () => client.disconnect();
  }, [client]);

  return <StreamContext value={client}>{children}</StreamContext>;
}
