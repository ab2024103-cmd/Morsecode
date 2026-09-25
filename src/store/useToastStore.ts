import { create } from 'zustand';
import type { Toast, ToastKind } from '../types';
import { uid } from '../lib/format';
import { nativeNotify } from '../ipc/commands';
import { useSettingsStore } from './useSettingsStore';

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, title: string, body?: string, ttl?: number) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  push: (kind, title, body, ttl = 5200) => {
    const toast: Toast = { id: uid('toast'), kind, title, body, ts: Date.now(), ttl };
    set((s) => ({ toasts: [toast, ...s.toasts].slice(0, 5) }));
    // Mirror to a native OS notification when enabled (no-op in the browser).
    if (useSettingsStore.getState().settings.nativeNotifications) {
      void nativeNotify(title, body ?? '');
    }
    if (ttl > 0) {
      window.setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== toast.id) }));
      }, ttl);
    }
    return toast.id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));
