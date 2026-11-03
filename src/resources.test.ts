import { expect, it } from "vitest";
import { CLIPBOARD_BYTES, HISTORY_CELLS, clipboardFits, historyLines, singleFlight } from "./resources";
it("budgets scrollback across many wide tabs without exceeding the cell budget", () => {
  const dimensions = Array.from({length:32},()=>({cols:240,rows:60}));
  const lines = historyLines(100000,dimensions);
  expect(dimensions.reduce((sum,size)=>sum+size.cols*(size.rows+lines),0)).toBeLessThanOrEqual(HISTORY_CELLS);
  expect(historyLines(10000,[{cols:80,rows:24}])).toBe(10000);
  expect(historyLines(100000,[{cols:1000,rows:1000}])).toBeLessThan(100000);
});
it("checks the actual UTF-8 clipboard byte limit",()=>{
 expect(clipboardFits('a'.repeat(CLIPBOARD_BYTES))).toBe(true);
 expect(clipboardFits('é'.repeat(CLIPBOARD_BYTES/2+1))).toBe(false);
 expect(clipboardFits('a'.repeat(CLIPBOARD_BYTES+1))).toBe(false);
});
it("coalesces concurrent refreshes and releases a failed operation for retry",async()=>{
 let count=0;let release!:(value:number)=>void;
 const run=singleFlight(()=>{count++;return new Promise<number>(resolve=>release=resolve);});
 const first=run(),second=run();await Promise.resolve();expect(count).toBe(1);expect(first).toBe(second);
 release(42);expect(await first).toBe(42);
 const third=run();await Promise.resolve();expect(count).toBe(2);release(43);expect(await third).toBe(43);
 let attempts=0;const failing=singleFlight(async()=>{if(++attempts===1)throw new Error('test');return 1;});
 await expect(failing()).rejects.toThrow('test');expect(await failing()).toBe(1);
});
