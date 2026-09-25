import { Icon } from '../shared/Icon';
import { IconButton } from '../shared/Button';
import { EmptyState } from '../shared/Panel';
import { useClipboardStore } from '../../store/useClipboardStore';
import { useToastStore } from '../../store/useToastStore';
import { formatTime } from '../../lib/format';

export function ClipboardFeed() {
  const items = useClipboardStore((s) => s.items);
  const toast = useToastStore((s) => s.push);

  if (!items.length) {
    return (
      <EmptyState
        title="No clipboard items yet"
        body="Snippets you send and receive show up here with sender and timestamp. Nothing is synced to the cloud."
      />
    );
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('success', 'Copied to clipboard');
    } catch {
      toast('error', 'Clipboard write blocked by the OS');
    }
  };

  return (
    <div>
      {items.map((item) => (
        <div className="clip-item" key={item.id}>
          <span className="txrow-ico">
            <Icon name={item.direction === 'send' ? 'send' : 'download'} size={15} />
          </span>
          <div className="clip-body">
            <p className="clip-text">{item.text}</p>
            <div className="clip-meta">
              <span className={item.direction === 'send' ? 'chip accent' : 'chip ok'}>
                {item.direction === 'send' ? 'sent' : 'received'}
              </span>
              <span>{item.deviceName}</span>
              <span>{formatTime(item.ts)}</span>
            </div>
          </div>
          <IconButton icon="copy" label="Copy" onClick={() => void copy(item.text)} />
        </div>
      ))}
    </div>
  );
}
