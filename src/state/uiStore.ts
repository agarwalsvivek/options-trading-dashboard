import { createStore, useStore } from './createStore.ts';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface UiState {
  theme: ThemePreference;
  selectedUnderlying: string | null;
  selectedOrderId: string | null;
}

// Per-viewer conveniences only; storage can be unavailable (private mode, blocked site data)
const STORAGE_KEYS = { theme: 'otd.theme', selectedUnderlying: 'otd.underlying' } as const;

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Not persisted; the in-memory state still works
  }
}

function initialTheme(): ThemePreference {
  const stored = readStorage(STORAGE_KEYS.theme);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

export const uiStore = createStore<UiState>({
  theme: initialTheme(),
  selectedUnderlying: readStorage(STORAGE_KEYS.selectedUnderlying),
  selectedOrderId: null,
});

uiStore.subscribe(() => {
  const { theme, selectedUnderlying } = uiStore.get();
  writeStorage(STORAGE_KEYS.theme, theme === 'system' ? null : theme);
  writeStorage(STORAGE_KEYS.selectedUnderlying, selectedUnderlying);
});

export function useUi<S>(selector: (state: UiState) => S): S {
  return useStore(uiStore, selector);
}

export function setUi(patch: Partial<UiState>) {
  uiStore.set((prev) => ({ ...prev, ...patch }));
}
