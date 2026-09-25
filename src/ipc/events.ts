/**
 * Event channel names emitted by the Rust core (`app.emit(...)`) and mirrored
 * one-for-one by the browser mock engine so the UI never branches on runtime.
 */
export const EVENTS = {
  deviceUpserted: 'morse://device-upserted',
  deviceLost: 'morse://device-lost',
  transferUpdated: 'morse://transfer-updated',
  transferRemoved: 'morse://transfer-removed',
  consentRequested: 'morse://consent-requested',
  consentResolved: 'morse://consent-resolved',
  clipboardReceived: 'morse://clipboard-received',
  historyAppended: 'morse://history-appended',
  log: 'morse://log',
  notify: 'morse://notify',
  trayAction: 'morse://tray-action',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

type Handler = (payload: unknown) => void;

/** Tiny local emitter — also the transport used by the mock engine. */
class LocalBus {
  private handlers = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  emit(event: string, payload: unknown): void {
    this.handlers.get(event)?.forEach((h) => h(payload));
  }
}

export const bus = new LocalBus();
