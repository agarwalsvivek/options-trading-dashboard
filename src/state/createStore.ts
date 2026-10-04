import { useSyncExternalStore } from 'react';

// Minimal external store for low-frequency UI state, read with useSyncExternalStore.
export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();

  return {
    get: () => state,
    set(next) {
      const value = typeof next === 'function' ? (next as (prev: T) => T)(state) : next;
      if (Object.is(value, state)) return;
      state = value;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// The selector must return a stable value (a primitive or an existing object) between changes
export function useStore<T, S = T>(store: Store<T>, selector: (state: T) => S = (s) => s as unknown as S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}
