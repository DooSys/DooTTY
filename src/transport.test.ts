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
