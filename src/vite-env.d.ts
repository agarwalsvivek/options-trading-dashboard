/// <reference types="vite/client" />

interface ImportMetaEnv {
  // WebSocket URL of the order stream, e.g. ws://localhost:9999
  readonly VITE_STREAM_URL?: string;
}
