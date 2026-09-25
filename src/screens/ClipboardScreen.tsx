import { Panel } from '../components/shared/Panel';
import { Button } from '../components/shared/Button';
import { ClipboardInput } from '../components/clipboard/ClipboardInput';
import { ClipboardFeed } from '../components/clipboard/ClipboardFeed';
import { useClipboardStore } from '../store/useClipboardStore';

export function ClipboardScreen() {
  const items = useClipboardStore((s) => s.items);
  const clear = useClipboardStore((s) => s.clear);

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1 className="screen-title">Clipboard Share</h1>
          <p className="screen-sub">
            Push text, links and snippets to a paired device instantly — same encrypted channel as files.
          </p>
        </div>
        <span className="chip">{items.length} items</span>
      </div>

      <div className="grid-2">
        <Panel title="Compose">
          <ClipboardInput />
        </Panel>

        <Panel
          title="Feed"
          flush
          actions={
            <Button size="sm" variant="ghost" icon="trash" onClick={clear} disabled={!items.length}>
              Clear
            </Button>
          }
        >
          <ClipboardFeed />
        </Panel>
      </div>
    </div>
  );
}
