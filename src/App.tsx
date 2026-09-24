import { useEffect } from 'react';
import { ThemeProvider } from './themes/ThemeProvider';
import { AppShell } from './components/layout/AppShell';
import { EVENTS } from './ipc/events';
import { initBackend, subscribe } from './ipc/commands';
import { useDeviceStore } from './store/useDeviceStore';
import { useTransferStore } from './store/useTransferStore';
import { useHistoryStore } from './store/useHistoryStore';
import { useClipboardStore } from './store/useClipboardStore';
import { useLogStore } from './store/useLogStore';
import { useToastStore } from './store/useToastStore';
import { useSettingsStore } from './store/useSettingsStore';
import type { ClipboardItem, ConsentRequest, Device, HistoryEntry, LogEvent, TransferItem, ToastKind } from './types';

export default function App() {
  useEffect(() => {
    const unsubscribers: Array<() => void> = [];

    unsubscribers.push(
      subscribe(EVENTS.deviceUpserted, (device: Device) => useDeviceStore.getState().upsert(device)),
      subscribe(EVENTS.deviceLost, (id: string) => useDeviceStore.getState().remove(id)),
      subscribe(EVENTS.transferUpdated, (item: TransferItem) => useTransferStore.getState().upsert(item)),
      subscribe(EVENTS.transferRemoved, (id: string) => useTransferStore.getState().remove(id)),
      subscribe(EVENTS.consentRequested, (request: ConsentRequest) =>
        useDeviceStore.getState().setConsent(request),
      ),
      subscribe(EVENTS.consentResolved, () => useDeviceStore.getState().setConsent(null)),
      subscribe(EVENTS.clipboardReceived, (item: ClipboardItem) => {
        useClipboardStore.getState().push(item);
        useToastStore.getState().push('info', 'Clipboard received', `${item.deviceName}: ${item.text.slice(0, 48)}`);
      }),
      subscribe(EVENTS.historyAppended, (entry: HistoryEntry) => useHistoryStore.getState().append(entry)),
      subscribe(EVENTS.log, (event: LogEvent) => useLogStore.getState().push(event)),
      subscribe(EVENTS.notify, (payload: { kind: ToastKind; title: string; body?: string }) =>
        useToastStore.getState().push(payload.kind, payload.title, payload.body),
      ),
      subscribe(EVENTS.trayAction, (action: string) => {
        if (action === 'pause-all') void useTransferStore.getState().pauseAll();
        if (action === 'resume-all') void useTransferStore.getState().resumeAll();
      }),
    );

    void useSettingsStore.getState().hydrate();
    void useHistoryStore.getState().hydrate();
    void initBackend().then(() => useDeviceStore.getState().refresh());

    return () => unsubscribers.forEach((off) => off());
  }, []);

  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}
