import { invoke } from '@tauri-apps/api/core';
import { distributionIcon } from './distribution-icons';
import { formatBytes } from './settings';
import { currentLanguage, onLanguageChanged, t } from './i18n';
import { HISTORY_MS, measure, retainHistory, storageFilesystems, filesystemUsage, type Measurement, type Snapshot } from './monitoring-model';

type Target = { sessionId: number; distribution: string; username: string | null };
type History = { snapshot?: Snapshot; points: Measurement[] };
const paths = {
  cpu: 'M6 6h12v12H6z M9 9h6v6H9z M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4',
  memory: 'M3 7h18v10H3z M7 10v4m4-4v4m4-4v4m4-4v4M6 17v3m4-3v3m4-3v3m4-3v3',
  network: 'M7 3v16m-4-4 4 4 4-4M17 21V5m-4 4 4-4 4 4',
  disk: 'M5 4h14l3 14H2z M2 18v3h20v-3M15 18h1m2 0h1',
  space: 'M4 3h16v18H4z M4 15h16M8 7h8m-8 4h5M16 18h1',
};
function icon(path: string, filled = false): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('aria-hidden','true');
  const p = document.createElementNS(svg.namespaceURI,'path');
  p.setAttribute('d',path); p.setAttribute('fill',filled?'currentColor':'none'); p.setAttribute('stroke',filled?'none':'currentColor'); p.setAttribute('stroke-width','1.5');
  svg.append(p); return svg;
}
export function initializeMonitoring(options: { native: boolean; target: () => Target | null; resize: () => void; error: (error: unknown) => void }): { sync: () => void } {
  const panel = document.getElementById('monitoring')!;
  const toggle = document.getElementById('monitor-toggle') as HTMLButtonElement;
  const pause = document.getElementById('monitor-pause') as HTMLButtonElement;
  const folder = document.getElementById('monitor-folder') as HTMLButtonElement;
  const stopped = new Set<number>();
  toggle.append(icon('M4 6h16M4 12h16M4 18h16')); 
  const title = document.getElementById('monitor-distribution')!;
  const image = document.getElementById('monitor-icon') as HTMLImageElement;
  const status = document.getElementById('monitor-state')!;
  const identity = document.getElementById('monitor-identity')!;
  const filesystems = document.getElementById('monitor-filesystems')!;
  const storage = document.getElementById('monitor-more')!;
  let expanded = false, paused = false, loading = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastTarget: Target | null = null;
  let error: string | null = null;
  const histories = new Map<string, History>();
  const key = (target: Target) => JSON.stringify([target.distribution,target.username]);
  const rows = Object.entries(paths).map(([name,path]) => {
    const row = document.createElement('section'); row.className = 'monitor-metric'; row.dataset.metric = name;
    const heading = document.createElement('div'); heading.className = 'monitor-metric-heading';
    const label = document.createElement('span'); label.className='monitor-detail';
    const value = document.createElement('strong'); value.textContent='—';
    const detail = document.createElement('small'); detail.className='monitor-detail';
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('viewBox','0 0 240 48'); svg.classList.add('monitor-chart','monitor-detail'); svg.setAttribute('role','img');
    heading.append(icon(path),label,value); row.append(heading,detail,svg); panel.insertBefore(row,document.getElementById('monitor-more'));
    return {name,row,label,value,detail,svg};
  });
  const percent = (value: number | null) => value === null ? '—' : `${Math.round(value)}%`;
  const speed = (value: number | null) => value === null ? '—' : `${formatBytes(value)}/s`;
  const compactSpeed = (value: number | null) => value === null ? '—' : value < 1024 ? `${Math.round(value)}B/s` : value < 1048576 ? `${(value/1024).toFixed(0)}K/s` : `${(value/1048576).toFixed(1)}M/s`;
  function graph(svg: SVGSVGElement, points: Measurement[], names: (keyof Measurement)[], fixedMax?: number): void {
    svg.replaceChildren();
    const now = Date.now();
    const max = fixedMax ?? Math.max(1,...points.flatMap(p => names.map(n => p[n] ?? 0)));
    for (const [index,name] of names.entries()) {
      let d = '', previousAt = 0;
      for (const point of points) {
        const value=point[name]; if(value===null || point.at < now-HISTORY_MS) { previousAt=0; continue; }
        const x=240*(point.at-now+HISTORY_MS)/HISTORY_MS, y=46-44*Math.min(1,value/max);
        d+=`${previousAt && point.at-previousAt<8000?'L':'M'}${x.toFixed(1)},${y.toFixed(1)} `; previousAt=point.at;
      }
      const path=document.createElementNS(svg.namespaceURI,'path'); path.setAttribute('d',d); path.setAttribute('fill','none'); path.setAttribute('stroke',index?'var(--graph-secondary, #b29cff)':'var(--graph-primary, #65c9eb)'); path.setAttribute('stroke-width','1.5'); svg.append(path);
    }
  }
  function render(): void {
    const target=options.target();
    panel.hidden = !target;
    if(!target) return;
    title.textContent=target.distribution; image.src=distributionIcon(target.distribution); panel.title=target.distribution;
    panel.classList.toggle('expanded',expanded); toggle.setAttribute('aria-expanded',String(expanded));
    toggle.title=t(expanded?'monitor.collapse':'monitor.expand'); toggle.setAttribute('aria-label',toggle.title);
    pause.replaceChildren(icon(paused?'M7 4l13 8-13 8z':'M6 4h4v16H6zM14 4h4v16h-4z',true)); pause.title=t(paused?'monitor.resume':'monitor.pause'); pause.setAttribute('aria-label',pause.title); pause.setAttribute('aria-pressed',String(paused));
    status.hidden = !paused && !error && !stopped.has(target.sessionId);
    status.textContent=stopped.has(target.sessionId)?t('monitor.stopped'):paused?t('monitor.paused'):error?t('monitor.unavailable'):''; status.title=error??'';
    const history=histories.get(key(target)); const snapshot=history?.snapshot; const point=history?.points.at(-1);
    panel.classList.toggle('stale',paused || !!error || !point || Date.now()-point.at>8000);
    identity.textContent=snapshot?`${snapshot.user}@${snapshot.hostname}\n${snapshot.kernel}\n${t('monitor.uptime',{value:Math.floor(snapshot.uptime/3600).toLocaleString(currentLanguage())})}`:'';
    for(const row of rows) {
      row.label.textContent=t(`monitor.${row.name}`); row.row.title=row.label.textContent;
      const label=row.label.textContent;
      if(row.name==='cpu') { row.value.textContent=percent(point?.cpu??null); row.detail.textContent=t('monitor.shared'); }
      if(row.name==='memory') { row.value.textContent=percent(point?.memory??null); row.detail.textContent=snapshot?`${formatBytes(snapshot.memoryTotal-snapshot.memoryAvailable)} / ${formatBytes(snapshot.memoryTotal)} · ${t('monitor.swap')}: ${formatBytes(snapshot.swapTotal-snapshot.swapFree)} / ${formatBytes(snapshot.swapTotal)}`:''; }
      if(row.name==='network') { row.value.textContent=expanded?`${speed(point?.receive??null)} ↓` : compactSpeed(point?.receive??null); row.detail.textContent=`${snapshot?.interface??'—'} · ↑ ${speed(point?.transmit??null)}`; }
      if(row.name==='disk') { row.value.textContent=expanded?`${speed(point?.read??null)} ↓`:compactSpeed(point?.read??null); row.detail.textContent=`${t('monitor.write')}: ${speed(point?.write??null)}`; }
      if(row.name==='space') { row.value.textContent=percent(point?.space??null); const root=snapshot?.filesystems.find(fs=>fs.mount==='/'); row.detail.textContent=root?`${t('monitor.free')}: ${formatBytes(root.available)} / ${formatBytes(root.total)}`:''; }
      const percentage = row.name==='cpu'?point?.cpu:row.name==='memory'?point?.memory:row.name==='space'?point?.space:null;
      row.value.dataset.load=percentage==null?'normal':percentage>=90?'critical':percentage>=75?'high':'normal';
      row.row.setAttribute('aria-label',`${label}: ${row.value.textContent}`);
      row.row.title=`${label}: ${row.value.textContent} · ${row.detail.textContent}`;
      row.svg.setAttribute('aria-label',`${label} · ${t('monitor.history')}`);
      if(expanded) graph(row.svg,history?.points??[],row.name==='network'?['receive','transmit']:row.name==='disk'?['read','write']:[row.name==='space'?'space':row.name==='memory'?'memory':'cpu'],['cpu','memory','space'].includes(row.name)?100:undefined);
    }
    filesystems.replaceChildren();
    const volumes = storageFilesystems(snapshot?.filesystems ?? []);
    storage.hidden = volumes.length === 0;
    if (expanded) for (const fs of volumes) {
      const entry = document.createElement('div');
      entry.className = 'monitor-filesystem';
      const heading = document.createElement('div');
      heading.className = 'monitor-filesystem-heading';
      const name = document.createElement('strong');
      name.textContent = fs.mount;
      const usage = filesystemUsage(fs);
      const value = document.createElement('span');
      value.textContent = percent(usage);
      heading.append(icon(paths.space), name, value);
      const device = document.createElement('small');
      device.className = 'monitor-filesystem-device';
      device.textContent = fs.device;
      device.title = `${fs.mount} · ${fs.device}`;
      const bar = document.createElement('div');
      bar.className = 'monitor-filesystem-bar';
      bar.setAttribute('role', 'meter');
      bar.setAttribute('aria-label', `${t('monitor.used')} · ${fs.mount}`);
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      if (usage !== null) bar.setAttribute('aria-valuenow', String(Math.round(usage)));
      else bar.setAttribute('aria-valuetext', '—');
      bar.dataset.load = usage !== null && usage >= 90 ? 'critical' : usage !== null && usage >= 75 ? 'high' : 'normal';
      const fill = document.createElement('span');
      fill.style.width = `${usage ?? 0}%`;
      bar.append(fill);
      const sizes = document.createElement('dl');
      for (const [label, bytes] of [[t('monitor.total'), fs.total], [t('monitor.usedShort'), fs.used], [t('monitor.free'), fs.available]] as const) {
        const term = document.createElement('dt'); term.textContent = label;
        const amount = document.createElement('dd'); amount.textContent = formatBytes(bytes);
        sizes.append(term, amount);
      }
      entry.append(heading, device, bar, sizes);
      filesystems.append(entry);
    }
  }
  async function sample(): Promise<void> {
    clearTimeout(timer);
    const target=options.target();
    if(!target || stopped.has(target.sessionId) || paused || document.hidden || !options.native || loading) { render(); return; }
    loading=true; render();
    try {
      const snapshot=await invoke<Snapshot>('monitoring_snapshot',{sessionId:target.sessionId});
      const current=options.target();
      if(current?.sessionId!==target.sessionId) return;
      const id=key(target), history=histories.get(id)??{points:[]};
      const point=measure(snapshot,history.snapshot,Date.now());
      history.points=retainHistory(history.points,point); history.snapshot=snapshot;
      histories.delete(id); histories.set(id,history);
      if(histories.size>32) histories.delete(histories.keys().next().value!);
      error=null;
    } catch(reason) { if(options.target()?.sessionId===target.sessionId) { error=String(reason); if(error.includes('MONITOR_DISTRIBUTION_STOPPED')) { stopped.add(target.sessionId); if(stopped.size>32) stopped.delete(stopped.values().next().value!); } } }
    finally {
      loading=false; render();
      if(options.target() && !stopped.has(options.target()!.sessionId) && !paused && !document.hidden) timer=setTimeout(()=>void sample(),2000);
    }
  }
  function sync(): void {
    const wasHidden=panel.hidden;
    const target=options.target();
    if(target?.sessionId!==lastTarget?.sessionId) { lastTarget=target; error=null; clearTimeout(timer); if(!loading) void sample(); }
    render();
    if(wasHidden!==panel.hidden) options.resize();
  }
  toggle.onclick=()=>{ expanded=!expanded; render(); options.resize(); };
  pause.onclick=()=>{ paused=!paused; clearTimeout(timer); if(!paused) void sample(); render(); };
  folder.onclick=async()=>{ const target=options.target(); if(!target) return; folder.disabled=true; try { await invoke('open_profile_folder',{sessionId:target.sessionId}); } catch(reason) { options.error(reason); } finally { folder.disabled=false; } };
  document.addEventListener('visibilitychange',()=>{clearTimeout(timer); if(!document.hidden) void sample();});
  onLanguageChanged(render);
  return {sync};
}
