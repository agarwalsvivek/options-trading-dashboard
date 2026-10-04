import { describe, expect, it, vi } from 'vitest';
import { createStore } from './createStore.ts';

describe('createStore', () => {
  it('sets values directly or from the previous value', () => {
    const store = createStore(1);
    store.set(5);
    expect(store.get()).toBe(5);
    store.set((prev) => prev * 2);
    expect(store.get()).toBe(10);
  });

  it('notifies subscribers only when the value changes', () => {
    const store = createStore({ n: 1 });
    const listener = vi.fn();
    store.subscribe(listener);

    const same = store.get();
    store.set(same);
    expect(listener).not.toHaveBeenCalled();

    store.set({ n: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops notifying after unsubscribe', () => {
    const store = createStore(0);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.set(1);
    expect(listener).not.toHaveBeenCalled();
  });
});
