import { useMemo } from 'react';
import logoUrl from '../../assets/logo.png';
import type { Device } from '../../types';
import { useThemeStore } from '../../store/useThemeStore';
import { useSettingsStore } from '../../store/useSettingsStore';

interface RadarViewProps {
  devices: Device[];
  selected: string[];
  onSelect: (id: string) => void;
}

/** Stable pseudo-random angle per device id so blips don't jump between ticks. */
function angleFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) % 3600;
  return (hash / 3600) * Math.PI * 2;
}

export function RadarView({ devices, selected, onSelect }: RadarViewProps) {
  const theme = useThemeStore((s) => s.theme);
  const settings = useSettingsStore((s) => s.settings);

  const blips = useMemo(
    () =>
      devices.map((device) => {
        const angle = angleFor(device.id);
        // Strong signal → close to the centre.
        const radius = 12 + (1 - device.signal / 100) * 34;
        return {
          device,
          left: `${50 + Math.cos(angle) * radius}%`,
          top: `${50 + Math.sin(angle) * radius}%`,
        };
      }),
    [devices],
  );

  return (
    <div className="radar-wrap">
      <div className="radar">
        <div className="radar-ring" style={{ width: '32%', height: '32%' }} />
        <div className="radar-ring" style={{ width: '62%', height: '62%' }} />
        <div className="radar-ring" style={{ width: '92%', height: '92%' }} />
        <div className="radar-cross" />
        <div className="radar-sweep" />

        {theme === 'hud' && (
          <>
            <span className="radar-readout" data-pos="tl">
              scan {settings.scanIntervalMs}ms
            </span>
            <span className="radar-readout" data-pos="tr">
              mdns {settings.mdnsEnabled ? 'up' : 'off'}
            </span>
            <span className="radar-readout" data-pos="bl">
              udp :33457
            </span>
            <span className="radar-readout" data-pos="br">
              contacts {devices.length}
            </span>
          </>
        )}

        <div className="radar-center" title="This device">
          <img src={logoUrl} alt="MorseCode" />
        </div>

        {blips.map(({ device, left, top }) => (
          <button
            type="button"
            key={device.id}
            className="blip"
            style={{ left, top }}
            data-trusted={device.trusted}
            data-selected={selected.includes(device.id)}
            onClick={() => onSelect(device.id)}
            title={`${device.name} — ${device.ip}`}
          >
            <span className="blip-dot" />
            <span className="blip-label">{device.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
