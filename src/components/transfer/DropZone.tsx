import { useEffect, useRef, useState } from 'react';
import { Icon } from '../shared/Icon';
import { Button } from '../shared/Button';
import { pickFiles, statPaths, isTauri, type PickedFile } from '../../ipc/commands';

interface DropZoneProps {
  onFiles: (files: PickedFile[]) => void;
  disabled?: boolean;
  hint?: string;
}

export function DropZone({ onFiles, disabled, hint }: DropZoneProps) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Keep the latest callbacks without re-subscribing the Tauri listeners.
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  // In the real app the webview's HTML5 drop events never fire: Tauri
  // intercepts native drag-drop and emits its own events (which also carry
  // the absolute paths the backend needs — a browser File has none).
  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    void (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const subs = await Promise.all([
        listen('tauri://drag-enter', () => {
          if (!disabledRef.current) setOver(true);
        }),
        listen('tauri://drag-over', () => {
          if (!disabledRef.current) setOver(true);
        }),
        listen('tauri://drag-leave', () => setOver(false)),
        listen<{ paths?: string[] }>('tauri://drag-drop', (event) => {
          setOver(false);
          if (disabledRef.current) return;
          const paths = event.payload?.paths ?? [];
          if (!paths.length) return;
          void statPaths(paths).then((files) => {
            if (files.length) onFilesRef.current(files);
          });
        }),
      ]);
      if (disposed) {
        subs.forEach((un) => un());
      } else {
        unlisteners.push(...subs);
      }
    })();
    return () => {
      disposed = true;
      unlisteners.forEach((un) => un());
    };
  }, []);

  const fromFileList = (list: FileList | null) => {
    if (!list) return;
    const files: PickedFile[] = Array.from(list).map((file) => ({
      name: file.name,
      // webkitRelativePath is populated for folder drops/selection.
      path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
      size: file.size,
    }));
    if (files.length) onFiles(files);
  };

  const browse = async (directory: boolean) => {
    if (disabled) return;
    if (isTauri) {
      const files = await pickFiles(directory);
      if (files.length) onFiles(files);
      return;
    }
    if (directory) {
      input.current?.setAttribute('webkitdirectory', '');
    } else {
      input.current?.removeAttribute('webkitdirectory');
    }
    input.current?.click();
  };

  return (
    <div
      className="dropzone"
      data-over={over}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        fromFileList(e.dataTransfer.files);
      }}
      onClick={() => void browse(false)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && void browse(false)}
    >
      <span className="drop-ico">
        <Icon name="send" size={24} />
      </span>
      <h3>Drop files or folders here</h3>
      <p>{hint ?? 'Multi-file and multi-folder selection supported · streamed in chunks, never buffered in RAM'}</p>
      <div className="row" style={{ marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
        <Button size="sm" icon="file" onClick={() => void browse(false)} disabled={disabled}>
          Choose files
        </Button>
        <Button size="sm" icon="folder" onClick={() => void browse(true)} disabled={disabled}>
          Choose folder
        </Button>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          fromFileList(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
