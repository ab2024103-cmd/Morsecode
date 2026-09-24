import { Panel, EmptyState } from '../components/shared/Panel';
import { Button } from '../components/shared/Button';
import { RadarView } from '../components/discovery/RadarView';
import { DeviceCard } from '../components/discovery/DeviceCard';
import { ManualConnect } from '../components/discovery/ManualConnect';
import { useDeviceStore, useDeviceList, useSelectedDevices } from '../store/useDeviceStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { startDiscovery, simulateIncoming } from '../ipc/commands';
import type { ScreenId } from '../types';

export function DiscoverScreen({ onNavigate }: { onNavigate: (screen: ScreenId) => void }) {
  const devices = useDeviceList();
  const selected = useSelectedDevices();
  const toggleSelected = useDeviceStore((s) => s.toggleSelected);
  const settings = useSettingsStore((s) => s.settings);

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1 className="screen-title">Discover</h1>
          <p className="screen-sub">
            Scanning the local subnet every {settings.scanIntervalMs}ms over mDNS
            {settings.udpFallbackEnabled ? ' with UDP broadcast fallback' : ''}. Nothing leaves the LAN.
          </p>
        </div>
        <div className="row">
          <Button size="sm" icon="refresh" onClick={() => void startDiscovery()}>
            Rescan
          </Button>
          <Button size="sm" variant="ghost" icon="bell" onClick={() => void simulateIncoming()}>
            Simulate inbound
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon="send"
            disabled={!selected.length}
            onClick={() => onNavigate('send')}
          >
            Send to {selected.length || 0}
          </Button>
        </div>
      </div>

      <div className="grid-2">
        <Panel title="Radar" flush>
          <RadarView devices={devices} selected={selected} onSelect={toggleSelected} />
          <div className="panel-b" style={{ paddingTop: 0 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="chip accent">{devices.length} discovered</span>
              <span className="chip ok">{devices.filter((d) => d.trusted).length} trusted</span>
              <span className="chip">{selected.length} selected</span>
            </div>
          </div>
        </Panel>

        <Panel
          title="Devices on this network"
          flush
          actions={<span className="chip">{devices.length}</span>}
        >
          {devices.length === 0 ? (
            <EmptyState
              title="Listening for peers…"
              body="Open MorseCode on another machine on the same network. Discovery needs no configuration, accounts or internet."
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
              {devices.map((device) => (
                <DeviceCard
                  key={device.id}
                  device={device}
                  selected={selected.includes(device.id)}
                  onClick={() => toggleSelected(device.id)}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Manual connect">
        <ManualConnect />
      </Panel>
    </div>
  );
}
