import { useMemo } from 'react';
import { Button } from '../shared/Button';
import { Icon } from '../shared/Icon';
import { useClipboardStore } from '../../store/useClipboardStore';
import { useDeviceStore, useDeviceList } from '../../store/useDeviceStore';
import { useToastStore } from '../../store/useToastStore';
import { useSelectedDevices } from '../../store/useDeviceStore';

export function ClipboardInput() {
  const devices = useDeviceList();
  const selected = useSelectedDevices();
  const selectOnly = useDeviceStore((s) => s.selectOnly);
  const draft = useClipboardStore((s) => s.draft);
  const setDraft = useClipboardStore((s) => s.setDraft);
  const send = useClipboardStore((s) => s.send);
  const toast = useToastStore((s) => s.push);

  const target = useMemo(
    () => devices.find((d) => d.id === selected[0]) ?? devices[0],
    [devices, selected],
  );

  const submit = async () => {
    if (!target || !draft.trim()) return;
    await send(target.id, draft);
    toast('success', 'Clipboard sent', `${draft.trim().slice(0, 40)}… → ${target.name}`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="field">
        <span className="field-label">Text, link or snippet</span>
        <textarea
          className="textarea"
          value={draft}
          placeholder="Paste anything — it is encrypted with the session key and pushed straight to the peer."
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
          }}
        />
      </div>

      <div className="row wrap">
        <span className="field-label">Send to</span>
        <select
          className="select"
          style={{ width: 'auto', minWidth: 190 }}
          value={target?.id ?? ''}
          onChange={(e) => selectOnly(e.target.value)}
        >
          {devices.length === 0 && <option value="">No peers discovered</option>}
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.name} — {device.ip}
            </option>
          ))}
        </select>

        <span className="spacer" />
        <span className="chip">
          <Icon name="lock" size={11} /> {draft.trim().length} chars
        </span>
        <Button
          variant="primary"
          icon="send"
          onClick={() => void submit()}
          disabled={!target || !draft.trim()}
        >
          Send (⌘/Ctrl + ⏎)
        </Button>
      </div>
    </div>
  );
}
