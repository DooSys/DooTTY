export type Filesystem = { device: string; mount: string; total: number; used: number; available: number };
/** Match df's Use%: unprivileged available space excludes reserved blocks. */
export function filesystemUsage(fs: Filesystem): number | null {
  const capacity = fs.used + fs.available;
  return capacity > 0 ? Math.max(0, Math.min(100, Math.ceil(fs.used / capacity * 100))) : null;
}
export function storageFilesystems(filesystems: Filesystem[]): Filesystem[] {
  const seen = new Set<string>();
  return filesystems
    .filter(fs => fs.mount === '/' || (/^\/dev\//.test(fs.device) && !/^\/dev\/loop/.test(fs.device)))
    .filter(fs => fs.mount !== '/usr/lib/linux-tools' && !fs.mount.startsWith('/usr/lib/linux-tools/') && !fs.mount.startsWith('/usr/lib/wsl/') && !fs.mount.startsWith('/usr/src/linux-headers'))
    .sort((a, b) => Number(b.mount === '/') - Number(a.mount === '/') || a.mount.localeCompare(b.mount))
    .filter(fs => { const device = fs.device;
      if (seen.has(device)) return false; seen.add(device); return true;
    });
}
export type Snapshot = {
  cpuTotal: number; cpuIdle: number; memoryTotal: number; memoryAvailable: number;
  swapTotal: number; swapFree: number; uptime: number; user: string; hostname: string; kernel: string;
  interface: string | null; received: number | null; transmitted: number | null;
  diskRead: number | null; diskWritten: number | null; filesystems: Filesystem[];
  hostStorage?: { volume: string; available: number } | null;
};
export type Measurement = { at: number; cpu: number | null; memory: number; receive: number | null; transmit: number | null; read: number | null; write: number | null; space: number | null };
export const HISTORY_MS = 5 * 60_000;
export function measure(snapshot: Snapshot, previous: Snapshot | undefined, at: number): Measurement {
  const elapsed = previous ? snapshot.uptime - previous.uptime : 0;
  const comparable = !!previous && elapsed > 0 && elapsed < 8;
  const rate = (now: number | null, before: number | null | undefined) => comparable && now !== null && before != null && now >= before ? (now - before) / elapsed : null;
  const total = previous ? snapshot.cpuTotal - previous.cpuTotal : 0;
  const idle = previous ? snapshot.cpuIdle - previous.cpuIdle : 0;
  const root = snapshot.filesystems.find(fs => fs.mount === '/');
  return {
    at, cpu: comparable && total > 0 && idle >= 0 ? Math.max(0, Math.min(100, (1 - idle / total) * 100)) : null,
    memory: Math.max(0, Math.min(100, 100 * (snapshot.memoryTotal - snapshot.memoryAvailable) / snapshot.memoryTotal)),
    receive: snapshot.interface === previous?.interface ? rate(snapshot.received, previous?.received) : null,
    transmit: snapshot.interface === previous?.interface ? rate(snapshot.transmitted, previous?.transmitted) : null,
    read: rate(snapshot.diskRead, previous?.diskRead), write: rate(snapshot.diskWritten, previous?.diskWritten),
    space: root ? filesystemUsage(root) : null,
  };
}
export function retainHistory(history: Measurement[], point: Measurement): Measurement[] {
  return [...history.filter(item => item.at > point.at - HISTORY_MS), point].slice(-151);
}
