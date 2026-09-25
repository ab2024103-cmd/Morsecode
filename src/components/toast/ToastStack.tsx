import { Icon, type IconName } from '../shared/Icon';
import { useToastStore } from '../../store/useToastStore';
import type { ToastKind } from '../../types';

const ICONS: Record<ToastKind, IconName> = {
  info: 'zap',
  success: 'check',
  error: 'alert',
  request: 'bell',
};

export function ToastStack() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast" data-kind={toast.kind} role="status">
          <span className="toast-ico">
            <Icon name={ICONS[toast.kind]} size={15} />
          </span>
          <span className="toast-copy">
            <strong>{toast.title}</strong>
            {toast.body && <span>{toast.body}</span>}
          </span>
          <button
            className="icon-btn"
            aria-label="Dismiss"
            onClick={() => dismiss(toast.id)}
            style={{ border: 0 }}
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
