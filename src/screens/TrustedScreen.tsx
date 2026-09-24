import { useMemo } from 'react';
import { Panel, EmptyState } from '../components/shared/Panel';
import { Button } from '../components/shared/Button';
import { TrustedDeviceCard } from '../components/trusted/TrustedDeviceCard';
import { DeviceCard } from '../components/discovery/DeviceCard';
import { useDeviceStore, useDeviceList } from '../store/useDeviceStore';
import { useHistoryStore } from '../store/useHistoryStore';
import { useToastStore } from '../store/useToastStore';
import { relativeTime } from '../lib/format';
import type { ScreenId } from '../types';

export function TrustedScreen({ onNavigate }: { onNavigate: (screen: ScreenId) => void }) {
  const devices = useDeviceList();
  const trust = useDeviceStore((s) => s.trust);
  const revoke = useDeviceStore((s) => s.revoke);
  const selectOnly = useDeviceStore((s) => s.selectOnly);
  const entries = useHistoryStore((s) => s.entries);
  const toast = useToastStore((s) => s.push);

  const trusted = devices.filter((d) => d.trusted);
  const untrusted = devices.filter((d) => !d.trusted);

  const lastTransferByDevice = useMemo(() => {
    const map: Record<string, string> = {};
    for (const entry of entries) {
      if (!map[entry.deviceId]) map[entry.deviceId] = `${entry.fileName} · ${relativeTime(entry.ts)}`;
    }
    return map;
  }, [entries]);

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1 className="screen-title">Trusted Devices</h1>
          <p className="screen-sub">
            Trusted peers skip the consent modal. Revoking takes effect on the next connection attempt.
          </p>
        </div>
        <span className="chip ok">{trusted.length} trusted</span>
      </div>

      {trusted.length === 0 ? (
        <Panel flush>
          <EmptyState
            title="No trusted devices yet"
            body="Tick “Trust this device” in the consent modal, or promote a discovered peer below."
          />
        </Panel>
      ) : (
        <div className="grid-3">
          {trusted.map((device) => (
            <TrustedDeviceCard
              key={device.id}
              device={device}
              lastTransfer={lastTransferByDevice[device.id]}
              onRevoke={() => {
                void revoke(device.id);
                toast('info', 'Trust revoked', device.name);
              }}
              onSend={() => {
                selectOnly(device.id);
                onNavigate('send');
              }}
            />
          ))}
        </div>
      )}

      <Panel title="Discovered · not trusted" flush>
        {untrusted.length === 0 ? (
          <EmptyState title="Every discovered device is trusted" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12 }}>
            {untrusted.map((device) => (
              <DeviceCard
                key={device.id}
                device={device}
                trailing={
                  <Button
                    size="sm"
                    icon="shield"
                    onClick={(e) => {
                      e.stopPropagation();
                      void trust(device.id);
                      toast('success', 'Device trusted', device.name);
                    }}
                  >
                    Trust
                  </Button>
                }
              />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
