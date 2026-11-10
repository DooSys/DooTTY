import { expect, it } from 'vitest';
import { measure, retainHistory, storageFilesystems, filesystemUsage, type Snapshot } from './monitoring-model';
const base: Snapshot = {cpuTotal:100,cpuIdle:50,memoryTotal:1000,memoryAvailable:400,swapTotal:0,swapFree:0,uptime:10,user:'alice',hostname:'debian',kernel:'linux',interface:'eth0',received:100,transmitted:200,diskRead:100,diskWritten:300,filesystems:[{mount:'/',device:'/dev/sdc',total:1000,used:200,available:750}]};
it('calculates deltas and root usage, keeping the first sample unmeasured',()=>{
 expect(measure(base,undefined,1).cpu).toBeNull();
 const m=measure({...base,cpuTotal:200,cpuIdle:125,received:1100,transmitted:600,diskRead:2100,diskWritten:4300,uptime:12},base,2);
 expect(m.cpu).toBe(25); expect(m.memory).toBe(60); expect(m.receive).toBe(500); expect(m.transmit).toBe(200); expect(m.read).toBe(1000); expect(m.write).toBe(2000); expect(m.space).toBe(22);
});
it('rejects rebooted counters, long pauses, absent devices and changed interfaces',()=>{
 const reset=measure({...base,cpuTotal:5,cpuIdle:1,received:1,interface:'wlan0',diskRead:null,uptime:1},base,2);
 expect(reset.cpu).toBeNull(); expect(reset.receive).toBeNull(); expect(reset.read).toBeNull();
 expect(measure({...base,uptime:50},base,3).cpu).toBeNull();
 expect(measure({...base,uptime:12,received:1},base,3).receive).toBeNull();
});
it('bounds history by both time and sample count',()=>{
 let points=[] as ReturnType<typeof measure>[];
 for(let i=0;i<1000;i++) points=retainHistory(points,measure(base,undefined,i*2000));
 expect(points.length).toBeLessThanOrEqual(151);
 expect(points[0].at).toBeGreaterThan(points.at(-1)!.at-300000);
});

it('shows the root first and excludes only the internal WSL kernel-tools mount', () => {
 const root = base.filesystems[0];
 const volume = {...root, mount:'/data', device:'/dev/sde'};
 const similar = {...root, device:'/dev/sdg', mount:'/usr/lib/linux-tools-custom'};
 const mounts = [volume, {...root,mount:'/usr/lib/linux-tools/6.18.54.1-microsoft-standard-WSL2'}, similar, root];
 expect(storageFilesystems(mounts).map(fs=>fs.mount)).toEqual(['/', '/data', '/usr/lib/linux-tools-custom']);
 expect(mounts).toHaveLength(4);
 expect(storageFilesystems([{...root,mount:'/usr/lib/linux-tools'}])).toEqual([]);
});

it('selects actual volumes once and uses df available-block semantics',()=>{
 const root=base.filesystems[0];
 expect(storageFilesystems([root,{...root,mount:'/bind'},
  {...root,device:'none',mount:'/mnt/wslg'},
  {...root,device:'C:\\',mount:'/usr/lib/wsl/drivers'},
  {...root,device:'C:\\',mount:'/mnt/c'},
  {...root,device:'D:\\',mount:'/mnt/d'},
  {...root,device:'/dev/loop0',mount:'/snap/image'},
 ]).map(fs=>fs.mount)).toEqual(['/']);
 expect(filesystemUsage({...root,total:1007,used:106,available:851})).toBe(12);
 expect(filesystemUsage({...root,used:0,available:0})).toBeNull();
});
