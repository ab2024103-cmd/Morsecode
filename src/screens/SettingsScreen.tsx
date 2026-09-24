import { SettingsPanel } from '../components/settings/SettingsPanel';
import type { ScreenId } from '../types';

export function SettingsScreen({ onNavigate }: { onNavigate: (screen: ScreenId) => void }) {
  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1 className="screen-title">Settings</h1>
          <p className="screen-sub">
            Stored in the local app config. No account, no telemetry, no outbound requests.
          </p>
        </div>
        <span className="chip ok">air-gapped safe</span>
      </div>

      <SettingsPanel onManageTrusted={() => onNavigate('trusted')} />
    </div>
  );
}
