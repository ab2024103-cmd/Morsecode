import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { TransferItem } from '../types';
import * as ipc from '../ipc/commands';
import type { PickedFile } from '../ipc/commands';

interface TransferState {
  items: Record<string, TransferItem>;
  order: string[];
  paused: boolean;

  upsert: (item: TransferItem) => void;
  remove: (id: string) => void;

  send: (deviceIds: string[], files: PickedFile[]) => Promise<void>;
  pause: (id: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  pauseAll: () => Promise<void>;
  resumeAll: () => Promise<void>;
  clearCompleted: () => Promise<void>;
}

export const useTransferStore = create<TransferState>()((set, get) => ({
  items: {},
  order: [],
  paused: false,

  upsert: (item) =>
    set((s) => ({
      items: { ...s.items, [item.id]: item },
      order: s.order.includes(item.id) ? s.order : [...s.order, item.id],
    })),
  remove: (id) =>
    set((s) => {
      const items = { ...s.items };
      delete items[id];
      return { items, order: s.order.filter((x) => x !== id) };
    }),

  send: async (deviceIds, files) => {
    if (!deviceIds.length || !files.length) return;
    await ipc.enqueueSend(deviceIds, files);
  },
  pause: async (id) => ipc.pauseTransfer(id),
  resume: async (id) => ipc.resumeTransfer(id),
  cancel: async (id) => ipc.cancelTransfer(id),
  pauseAll: async () => {
    set({ paused: true });
    await ipc.pauseAll();
  },
  resumeAll: async () => {
    set({ paused: false });
    await ipc.resumeAll();
  },
  clearCompleted: async () => {
    await ipc.clearCompleted();
    if (!ipc.isTauri) return;
    const remaining = get().order.filter((id) => {
      const item = get().items[id];
      return item && !['done', 'failed', 'skipped'].includes(item.status);
    });
    set({ order: remaining });
  },
}));

export const selectTransfers = (state: TransferState): TransferItem[] =>
  state.order.map((id) => state.items[id]).filter(Boolean);

export const selectByDirection = (state: TransferState, direction: TransferItem['direction']) =>
  selectTransfers(state).filter((t) => t.direction === direction);

export interface SessionStats {
  activeCount: number;
  queuedCount: number;
  doneCount: number;
  totalBytes: number;
  transferredBytes: number;
  speed: number;
  progress: number;
}

export function selectSessionStats(state: TransferState): SessionStats {
  const items = selectTransfers(state);
  const totalBytes = items.reduce((sum, t) => sum + t.size, 0);
  const transferredBytes = items.reduce((sum, t) => sum + t.transferred, 0);
  return {
    activeCount: items.filter((t) => t.status === 'active').length,
    queuedCount: items.filter((t) => t.status === 'queued' || t.status === 'handshaking').length,
    doneCount: items.filter((t) => t.status === 'done').length,
    totalBytes,
    transferredBytes,
    speed: items.filter((t) => t.status === 'active').reduce((sum, t) => sum + t.speed, 0),
    progress: totalBytes ? (transferredBytes / totalBytes) * 100 : 0,
  };
}

/**
 * Derived selectors return fresh arrays/objects on every call, so they must be
 * read through `useShallow` — otherwise `useSyncExternalStore` sees a new
 * snapshot each render and React bails out with "maximum update depth".
 */
export const useTransfers = () => useTransferStore(useShallow(selectTransfers));

export const useTransfersByDirection = (direction: TransferItem['direction']) =>
  useTransferStore(useShallow((state: TransferState) => selectByDirection(state, direction)));

export const useSessionStats = () => useTransferStore(useShallow(selectSessionStats));
