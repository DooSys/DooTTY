import { describe, expect, it } from 'vitest';
import { InputQueue } from './transport';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('terminal input transport', () => {
  it('serializes input and pastes without corrupting UTF-8 across IPC chunks', async () => {
    const received: number[] = [];
    const lengths: number[] = [];
    let active = 0;
    const queue = new InputQueue(async (bytes) => {
      expect(++active).toBe(1);
      await tick();
      received.push(...bytes);
      lengths.push(bytes.length);
      active--;
    }, (error) => { throw error; });
    const text = 'é😀\r\n'.repeat(6000);
    queue.push(new TextEncoder().encode(text));
    queue.push(new Uint8Array([3])); // Ctrl+C must follow the preceding input.
    for (let i = 0; i < 100 && received.length < new TextEncoder().encode(text).length + 1; i++) await tick();
    expect(new TextDecoder().decode(new Uint8Array(received))).toBe(`${text}\x03`);
    expect(lengths.every((length) => length <= 8192)).toBe(true);
  });

  it('stops queued input after the session closes', async () => {
    let release!: () => void;
    const sent: number[][] = [];
    const queue = new InputQueue(async (bytes) => {
      sent.push(bytes);
      await new Promise<void>((resolve) => { release = resolve; });
    }, (error) => { throw error; });
    queue.push(new Uint8Array(20000));
    queue.cancel();
    release();
    await tick();
    queue.push(new Uint8Array([1]));
    expect(sent).toHaveLength(1);
  });

  it('rejects an oversized paste before sending any of it', () => {
    const sent: number[][] = [];
    const errors: unknown[] = [];
    const queue = new InputQueue(async (bytes) => { sent.push(bytes); }, (error) => errors.push(error), 10);
    queue.push(new Uint8Array(11));
    expect(sent).toEqual([]);
    expect(errors).toHaveLength(1);
  });
});

it('closes an interrupted bracketed paste without sending its remaining text', async () => {
 let release!: () => void;
 const chunks: number[][] = [];
 const queue = new InputQueue(async bytes => {
  chunks.push(bytes);
  if(chunks.length===1) await new Promise<void>(resolve=>{release=resolve;});
 }, error=>{throw error;});
 queue.push(new TextEncoder().encode('\x1b[200~'+'x'.repeat(20000)+'\x1b[201~'));
 const stopped=queue.cancel(true);
 release();
 await stopped;
 expect(chunks).toHaveLength(2);
 expect(new TextDecoder().decode(new Uint8Array(chunks[1]))).toBe('\x1b[201~');
 expect(chunks[0].length).toBeLessThanOrEqual(8192);
});
it('never splits a paste delimiter across cancellable IPC messages', async () => {
 const chunks: number[][] = [];
 const queue=new InputQueue(async bytes=>{chunks.push(bytes);},error=>{throw error;});
 const text='a'.repeat(8190)+'\x1b[200~'+'x'.repeat(8190)+'\x1b[201~';
 queue.push(new TextEncoder().encode(text));
 for(let i=0;i<10 && chunks.reduce((n,c)=>n+c.length,0)<text.length;i++) await tick();
 expect(new TextDecoder().decode(new Uint8Array(chunks.flat()))).toBe(text);
 for(const chunk of chunks) {
  const s=new TextDecoder().decode(new Uint8Array(chunk));
  expect(s).not.toMatch(/\x1b(?:\[(?:2(?:0(?:[01])?)?)?)?$/);
 }
});
