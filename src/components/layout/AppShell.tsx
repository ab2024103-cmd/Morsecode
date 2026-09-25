import { useState } from 'react';
import { Titlebar } from './Titlebar';
import { Sidebar } from './Sidebar';
import { RightRail } from './RightRail';
import { ConsentModal } from '../consent/ConsentModal';
import { ToastStack } from '../toast/ToastStack';
import { TrayMenu } from '../tray/TrayMenu';
import { DiscoverScreen } from '../../screens/DiscoverScreen';
import { SendScreen } from '../../screens/SendScreen';
import { ReceiveScreen } from '../../screens/ReceiveScreen';
import { HistoryScreen } from '../../screens/HistoryScreen';
import { ClipboardScreen } from '../../screens/ClipboardScreen';
import { TrustedScreen } from '../../screens/TrustedScreen';
import { SettingsScreen } from '../../screens/SettingsScreen';
import { LogScreen } from '../../screens/LogScreen';
import type { ScreenId } from '../../types';

export function AppShell() {
  const [screen, setScreen] = useState<ScreenId>('discover');
  const [trayOpen, setTrayOpen] = useState(false);

  return (
    <div className="app-root">
      <div className="fx-bg" aria-hidden="true" />

      <Titlebar onToggleTray={() => setTrayOpen((v) => !v)} />

      <div className="app-body">
        <Sidebar screen={screen} onNavigate={setScreen} />

        <main className="main">
          {screen === 'discover' && <DiscoverScreen onNavigate={setScreen} />}
          {screen === 'send' && <SendScreen />}
          {screen === 'receive' && <ReceiveScreen />}
          {screen === 'history' && <HistoryScreen />}
          {screen === 'clipboard' && <ClipboardScreen />}
          {screen === 'trusted' && <TrustedScreen onNavigate={setScreen} />}
          {screen === 'settings' && <SettingsScreen onNavigate={setScreen} />}
          {screen === 'log' && <LogScreen />}
        </main>

        <RightRail />
      </div>

      <TrayMenu open={trayOpen} onClose={() => setTrayOpen(false)} />
      <ConsentModal />
      <ToastStack />
    </div>
  );
}
