import { useSyncExternalStore } from 'react';

export interface Toast {
  id: number;
  message: string;
}

const TOAST_LIFETIME_MS = 4000;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function setToasts(next: Toast[]) {
  toasts = next;
  listeners.forEach((listener) => listener());
}

export function dismissToast(id: number) {
  setToasts(toasts.filter((toast) => toast.id !== id));
}

export function pushToast(message: string) {
  const id = nextId++;
  setToasts([...toasts, { id, message }]);
  setTimeout(() => dismissToast(id), TOAST_LIFETIME_MS);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useToasts() {
  return useSyncExternalStore(subscribe, () => toasts);
}
