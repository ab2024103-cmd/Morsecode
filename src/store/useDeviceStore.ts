import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { ConsentRequest, Device } from '../types';
import * as ipc from '../ipc/commands';

interface DeviceState {
  devices: Record<string, Device>;
  /** Devices selected as broadcast targets on the Send screen. */
  selected: string[];
  consent: ConsentRequest | null;
  connecting: boolean;
  lastError: string | null;

  upsert: (device: Device) => void;
  remove: (id: string) => void;
  setConsent: (request: ConsentRequest | null) => void;
  toggleSelected: (id: string) => void;
  selectOnly: (id: string) => void;
  clearSelection: () => void;

  refresh: () => Promise<void>;
  connectManual: (ip: string, port: number) => Promise<void>;
  respondConsent: (accept: boolean, trust: boolean) => Promise<void>;
  trust: (id: string) => Promise<void>;
  revoke: (id: string) => Promise<void>;
}

export const useDeviceStore = create<DeviceState>()((set, get) => ({
  devices: {},
  selected: [],
  consent: null,
  connecting: false,
  lastError: null,

  upsert: (device) => set((s) => ({ devices: { ...s.devices, [device.id]: device } })),
  remove: (id) =>
    set((s) => {
      const devices = { ...s.devices };
      delete devices[id];
      return { devices, selected: s.selected.filter((d) => d !== id) };
    }),
  setConsent: (consent) => set({ consent }),
  toggleSelected: (id) =>
    set((s) => ({
      selected: s.selected.includes(id) ? s.selected.filter((d) => d !== id) : [...s.selected, id],
    })),
  selectOnly: (id) => set({ selected: [id] }),
  clearSelection: () => set({ selected: [] }),

  refresh: async () => {
    const list = await ipc.listDevices();
    set({ devices: Object.fromEntries(list.map((d) => [d.id, d])) });
  },

  connectManual: async (ip, port) => {
    set({ connecting: true, lastError: null });
    try {
      const device = await ipc.manualConnect(ip, port);
      get().upsert(device);
      get().selectOnly(device.id);
    } catch (error) {
      set({ lastError: String(error) });
    } finally {
      set({ connecting: false });
    }
  },

  respondConsent: async (accept, trust) => {
    const request = get().consent;
    if (!request) return;
    set({ consent: null });
    await ipc.respondConsent(request.id, accept, trust);
  },

  trust: async (id) => {
    await ipc.trustDevice(id);
    const device = get().devices[id];
    if (device) get().upsert({ ...device, trusted: true });
  },

  revoke: async (id) => {
    await ipc.revokeTrust(id);
    const device = get().devices[id];
    if (device) get().upsert({ ...device, trusted: false });
  },
}));

export const selectDeviceList = (state: DeviceState): Device[] =>
  Object.values(state.devices).sort((a, b) => b.signal - a.signal);

/** Shallow-stable hooks (see the note in `useTransferStore`). */
export const useDeviceList = () => useDeviceStore(useShallow(selectDeviceList));

export const useSelectedDevices = () => useDeviceStore(useShallow((s: DeviceState) => s.selected));
