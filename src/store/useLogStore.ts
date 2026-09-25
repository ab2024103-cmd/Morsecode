import { create } from 'zustand';
import type { LogEvent, LogLevel } from '../types';
import { uid } from '../lib/format';

interface LogState {
  events: LogEvent[];
  paused: boolean;
  push: (event: LogEvent) => void;
  local: (level: LogLevel, tag: string, message: string) => void;
  setPaused: (paused: boolean) => void;
  clear: () => void;
}

const MAX = 300;

export const useLogStore = create<LogState>()((set, get) => ({
  events: [],
  paused: false,
  push: (event) => {
    if (get().paused) return;
    set((s) => ({ events: [...s.events, event].slice(-MAX) }));
  },
  local: (level, tag, message) =>
    get().push({ id: uid('log'), ts: Date.now(), level, tag, message }),
  setPaused: (paused) => set({ paused }),
  clear: () => set({ events: [] }),
}));
