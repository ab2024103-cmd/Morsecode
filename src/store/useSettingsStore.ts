import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Settings } from '../types';
import { loadSettings, saveSettings } from '../ipc/commands';

export const DEFAULT_SETTINGS: Settings = {
  deviceName: 'THIS-MACHINE',
  downloadDir: '~/Downloads/MorseCode',
  discoveryEnabled: true,
  mdnsEnabled: true,
  udpFallbackEnabled: true,
  scanIntervalMs: 1200,
  transferPort: 33456,
  compression: true,
  concurrency: 8,
  bandwidthLimitPct: 100,
  resumeEnabled: true,
  confirmLargeTransfers: true,
  largeTransferThresholdMb: 500,
  minimizeToTray: true,
  nativeNotifications: true,
  showSystemLogClassic: true,
};

interface SettingsState {
  settings: Settings;
  hydrated: boolean;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  replace: (settings: Settings) => void;
  reset: () => void;
  hydrate: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      hydrated: false,
      update: (key, value) => {
        const next = { ...get().settings, [key]: value };
        set({ settings: next });
        void saveSettings(next);
      },
      replace: (settings) => {
        set({ settings });
        void saveSettings(settings);
      },
      reset: () => {
        set({ settings: DEFAULT_SETTINGS });
        void saveSettings(DEFAULT_SETTINGS);
      },
      hydrate: async () => {
        const fromDisk = await loadSettings();
        if (fromDisk) set({ settings: { ...DEFAULT_SETTINGS, ...fromDisk }, hydrated: true });
        else set({ hydrated: true });
      },
    }),
    { name: 'morsecode.settings', partialize: (s) => ({ settings: s.settings }) },
  ),
);
