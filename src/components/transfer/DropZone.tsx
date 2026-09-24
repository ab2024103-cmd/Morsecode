import { useRef, useState } from 'react';
import { Icon } from '../shared/Icon';
import { Button } from '../shared/Button';
import { pickFiles, isTauri, type PickedFile } from '../../ipc/commands';

interface DropZoneProps {
  onFiles: (files: PickedFile[]) => void;
  disabled?: boolean;
  hint?: string;
}

export function DropZone({ onFiles, disabled, hint }: DropZoneProps) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

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
