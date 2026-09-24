import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ClipboardItem } from '../types';
import * as ipc from '../ipc/commands';

interface ClipboardState {
  items: ClipboardItem[];
  draft: string;
  setDraft: (draft: string) => void;
  push: (item: ClipboardItem) => void;
  send: (deviceId: string, text: string) => Promise<void>;
  clear: () => void;
}

export const useClipboardStore = create<ClipboardState>()(
  persist(
    (set) => ({
      items: [],
      draft: '',
      setDraft: (draft) => set({ draft }),
      push: (item) => set((s) => ({ items: [item, ...s.items].slice(0, 200) })),
      send: async (deviceId, text) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        const item = await ipc.sendClipboard(deviceId, trimmed);
        set((s) => ({ items: [item, ...s.items].slice(0, 200), draft: '' }));
      },
      clear: () => set({ items: [] }),
    }),
    { name: 'morsecode.clipboard', partialize: (s) => ({ items: s.items }) },
  ),
);
