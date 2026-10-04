import { createStore, useStore } from '../state/createStore.ts';

export interface Toast {
  id: number;
  message: string;
}

const TOAST_LIFETIME_MS = 4000;

const toastStore = createStore<Toast[]>([]);
let nextId = 1;

export function dismissToast(id: number) {
  toastStore.set((toasts) => toasts.filter((toast) => toast.id !== id));
}

export function pushToast(message: string) {
  const id = nextId++;
  toastStore.set((toasts) => [...toasts, { id, message }]);
  setTimeout(() => dismissToast(id), TOAST_LIFETIME_MS);
}

export function useToasts() {
  return useStore(toastStore);
}
