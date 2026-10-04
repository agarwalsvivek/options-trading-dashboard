import { useEffect, useState } from 'react';
import type { ConnectionStatus } from '../../shared/protocol/worker-messages.ts';
import { useConnectionStatus, useStreamClient, useStreamStats } from '../stream/streamContext.ts';
import './StatusBar.css';

// Current time, refreshed on an interval. Only mounted while a timer is on screen.
function useNow(intervalMs: number) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function SecondsUntil({ until }: { until: number }) {
  const now = useNow(250);
  return <>{Math.max(0, Math.ceil((until - now) / 1000))}s</>;
}

function SecondsSince({ since }: { since: number }) {
  const now = useNow(1000);
  return <>{Math.max(0, Math.floor((now - since) / 1000))}s</>;
}

function StatusText({ status }: { status: ConnectionStatus }) {
  switch (status.state) {
    case 'live':
      return <>Live</>;
    case 'connecting':
      return <>{status.attempt === 0 ? 'Connecting…' : `Connecting… (attempt ${status.attempt + 1})`}</>;
    case 'stale':
      return (
        <>
          Stale — no data for <SecondsSince since={status.lastMessageAt} />
        </>
      );
    case 'reconnecting':
      return (
        <>
          Reconnecting in <SecondsUntil key={status.retryAt} until={status.retryAt} /> (attempt{' '}
          {status.attempt}) · {status.reason}
        </>
      );
  }
}

export function StatusBar() {
  const client = useStreamClient();
  const status = useConnectionStatus();
  const stats = useStreamStats();

  return (
    <footer className="status-bar" data-state={status.state} role="status" aria-live="polite">
      <span className="status-dot" aria-hidden="true" />
      <span className="status-text">
        <StatusText status={status} />
      </span>
      {status.state === 'live' && stats && (
        <span className="status-stats">
          {stats.rowsPerSec.toLocaleString()} rows/s · seq {stats.lastSeq} · lag {stats.lagMs} ms
        </span>
      )}
      {status.state === 'reconnecting' && (
        <button type="button" className="button status-retry" onClick={client.reconnectNow}>
          Retry now
        </button>
      )}
    </footer>
  );
}
