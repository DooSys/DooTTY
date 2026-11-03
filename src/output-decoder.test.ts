import { expect, it } from "vitest";
import { OutputDecoder } from "./output-decoder";
it("preserves split UTF-8 sequences across bounded chunks",()=>{
 const decoder=new OutputDecoder();const text='été 😀\r\n'.repeat(40);const bytes=new TextEncoder().encode(text);let output='';
 for(let index=0;index<bytes.length;index+=3)output+=decoder.decode(Array.from(bytes.slice(index,index+3)));
 output+=decoder.decode([],true);expect(output).toBe(text);
});
it("recognizes UTF-16LE and short output without losing partial characters",()=>{
 const decoder=new OutputDecoder();const text='Version WSL : 3.0.3.0\r\n';const bytes=Array.from(text).flatMap(char=>[char.charCodeAt(0)&255,char.charCodeAt(0)>>8]);
 let output='';for(const byte of bytes)output+=decoder.decode([byte]);output+=decoder.decode([],true);expect(output).toBe(text);
 const short=new OutputDecoder();expect(short.decode([79,75])).toBe('');expect(short.decode([],true)).toBe('OK');
});
