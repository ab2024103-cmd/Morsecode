import { useEffect, useState } from 'react';
import { hostInfo, type HostInfo } from '../ipc/commands';

const FALLBACK: HostInfo = {
  hostname: 'THIS-MACHINE',
  ip: '192.168.1.17',
  platform: 'unknown',
  version: '1.0.0',
  runtime: 'browser',
};

export function useHostInfo(): HostInfo {
  const [info, setInfo] = useState<HostInfo>(FALLBACK);
  useEffect(() => {
    let alive = true;
    void hostInfo().then((value) => {
      if (alive) setInfo(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return info;
}
