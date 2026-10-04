import { dismissToast, useToasts } from './toasts.ts';
import './Toasts.css';

export function Toasts() {
  const toasts = useToasts();

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast">
          <span>{toast.message}</span>
          <button
            type="button"
            className="toast-dismiss"
            aria-label="Dismiss"
            onClick={() => dismissToast(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
