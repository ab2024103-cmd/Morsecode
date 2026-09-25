import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { HistoryEntry, HistoryStatus } from '../types';
import * as ipc from '../ipc/commands';
import { formatDateTime } from '../lib/format';

export type HistoryTab = 'all' | 'sent' | 'received' | 'failed';

interface HistoryState {
  entries: HistoryEntry[];
  tab: HistoryTab;
  query: string;
  append: (entry: HistoryEntry) => void;
  setTab: (tab: HistoryTab) => void;
  setQuery: (query: string) => void;
  hydrate: () => Promise<void>;
  clear: () => Promise<void>;
  exportCsv: () => Promise<void>;
}

const seed: HistoryEntry[] = [
  { id: 'h1', ts: Date.now() - 1000 * 60 * 6, deviceId: 'dev_orion', deviceName: 'ORION-WS', fileName: 'quarterly-deck.key', size: 88_400_000, durationMs: 4200, status: 'sent' },
  { id: 'h2', ts: Date.now() - 1000 * 60 * 42, deviceId: 'dev_atlas', deviceName: 'Atlas MacBook Pro', fileName: 'drone-pass-02.mov', size: 2_140_000_000, durationMs: 61_800, status: 'received' },
  { id: 'h3', ts: Date.now() - 1000 * 60 * 95, deviceId: 'dev_nyx', deviceName: 'nyx-linux-box', fileName: 'backup-2026-09.tar.zst', size: 5_380_000_000, durationMs: 148_000, status: 'sent' },
  { id: 'h4', ts: Date.now() - 1000 * 60 * 160, deviceId: 'dev_vega', deviceName: 'VEGA-STUDIO', fileName: 'session-stems.zip', size: 940_000_000, durationMs: 0, status: 'failed' },
  { id: 'h5', ts: Date.now() - 1000 * 60 * 320, deviceId: 'dev_atlas', deviceName: 'Atlas MacBook Pro', fileName: 'contract-signed.pdf', size: 1_820_000, durationMs: 300, status: 'received' },
  { id: 'h6', ts: Date.now() - 1000 * 60 * 600, deviceId: 'dev_pixel', deviceName: 'lab-nuc-02', fileName: 'telemetry-dump.csv', size: 312_000_000, durationMs: 9100, status: 'skipped' },
];

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
      entries: seed,
      tab: 'all',
      query: '',
      append: (entry) => set((s) => ({ entries: [entry, ...s.entries].slice(0, 1000) })),
      setTab: (tab) => set({ tab }),
      setQuery: (query) => set({ query }),
      hydrate: async () => {
        const rows = await ipc.listHistory();
        if (rows.length) set({ entries: rows });
      },
      clear: async () => {
        await ipc.clearHistory();
        set({ entries: [] });
      },
      exportCsv: async () => {
        const header = 'timestamp,device,file,bytes,duration_ms,status';
        const lines = get().entries.map((e) =>
          [formatDateTime(e.ts), e.deviceName, e.fileName, e.size, e.durationMs, e.status]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(','),
        );
        await ipc.exportHistoryCsv([header, ...lines].join('\n'));
      },
    }),
    { name: 'morsecode.history', partialize: (s) => ({ entries: s.entries }) },
  ),
);

export function filterHistory(entries: HistoryEntry[], tab: HistoryTab, query: string): HistoryEntry[] {
  const needle = query.trim().toLowerCase();
  const wanted: Record<HistoryTab, HistoryStatus[] | null> = {
    all: null,
    sent: ['sent'],
    received: ['received'],
    failed: ['failed', 'skipped'],
  };
  const statuses = wanted[tab];
  return entries.filter((entry) => {
    if (statuses && !statuses.includes(entry.status)) return false;
    if (!needle) return true;
    return (
      entry.fileName.toLowerCase().includes(needle) ||
      entry.deviceName.toLowerCase().includes(needle) ||
      entry.status.includes(needle)
    );
  });
}
