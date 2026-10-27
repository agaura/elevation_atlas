import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {halfToFloat, decodeSRGB, linearToPQ, prepareHdrPixels} from '../hdr-pixels.js';
import {tagHdrAvif} from '../avif-hdr.js';
import {captureTexture} from '../frame-capture.js';

test('HDR conversion decodes half floats and maps reference white and 1000 nits to standard PQ',()=>{
 assert.equal(halfToFloat(0x3c00),1);assert.equal(halfToFloat(0x4000),2);
 assert.equal(halfToFloat(1),2**-24);assert.equal(halfToFloat(0xbc00),-1);
 assert.equal(halfToFloat(0x7c00),Infinity);assert.ok(Number.isNaN(halfToFloat(0x7e00)));
 assert.ok(Math.abs(linearToPQ(1)-.5806888810416109)<1e-9);
 assert.ok(Math.abs(linearToPQ(1000/203)-.751827096247041)<1e-9);
 assert.ok(linearToPQ(2)>linearToPQ(1));
});

function frame(colorSpace='display-p3'){
 const pixels=new Uint8Array(512),view=new DataView(pixels.buffer);
 // Padding must not be interpreted as pixels; second scanline has a different color.
 for(const [row,values] of [[0,[0x4000,0x3800,0x3c00,0x3c00]],[1,[0x3c00,0x3c00,0x3c00,0x3c00]]])
  values.forEach((value,index)=>view.setUint16(row*256+index*2,value,true));
 return {width:1,height:2,format:'rgba16float',bytesPerRow:256,pixels,colorSpace};
}

test('export preserves full dimensions, padded rows, wide-gamut channels and HDR highlights',()=>{
 const result=prepareHdrPixels(frame());assert.equal(result.width,1);assert.equal(result.height,2);assert.equal(result.data.length,8);
 assert.deepEqual(Array.from(result.data.slice(0,4)),[2,.5,1].map(value=>Math.round(linearToPQ(decodeSRGB(value))*4095)).concat(4095));
 assert.ok(result.data[0]>result.data[4]);assert.equal(result.clipped,0);
 const fallback=prepareHdrPixels(frame('srgb'));
 assert.deepEqual(Array.from(fallback.data.slice(4,7)),[2378,2378,2378]);
 assert.notDeepEqual(Array.from(fallback.data.slice(0,3)),Array.from(result.data.slice(0,3)));
 const invalid=frame();new DataView(invalid.pixels.buffer).setUint16(0,0x7e00,true);
 assert.throws(()=>prepareHdrPixels(invalid),/non-finite/);
});

test('AVIF HDR tagging changes color descriptions without rewriting compressed image samples',()=>{
 const source=new Uint8Array(readFileSync(new URL('./fixtures/avif-12bit-rgb.avif',import.meta.url))),before=source.slice();
 const tagged=tagHdrAvif(source);assert.equal(tagged.length,before.length);
 const changes=[];for(let i=0;i<tagged.length;i++)if(tagged[i]!==before[i])changes.push(i);
 assert.ok(changes.length>0&&changes.length<=8);
 const marker=new TextEncoder().encode('nclx');let nclx=-1;
 for(let i=0;i<tagged.length-4;i++)if(marker.every((value,index)=>tagged[i+index]===value))nclx=i;
 const view=new DataView(tagged.buffer);assert.equal(view.getUint16(nclx+4),12);assert.equal(view.getUint16(nclx+6),16);assert.equal(view.getUint16(nclx+8),0);assert.equal(tagged[nclx+10],128);
 // This generated fixture's AV1 frame payload begins after its sequence OBU.
 assert.deepEqual(tagged.slice(291),before.slice(291));
 assert.deepEqual(tagHdrAvif(tagged.slice()),tagged,'Tagging is idempotent');
 assert.throws(()=>tagHdrAvif(new Uint8Array(8)),/Invalid/);
 assert.throws(()=>tagHdrAvif(before.slice(0,30)),/Truncated/);
});

test('GPU capture uses aligned device-pixel rows and releases readback memory',async()=>{
 const previous={usage:globalThis.GPUBufferUsage,map:globalThis.GPUMapMode};
 globalThis.GPUBufferUsage={COPY_DST:1,MAP_READ:2};globalThis.GPUMapMode={READ:1};
 try{
  let destroyed=false,descriptor,copy;
  const buffer={async mapAsync(){},getMappedRange(){return new ArrayBuffer(768);},destroy(){destroyed=true;}};
  const device={limits:{maxBufferSize:10000},createBuffer(value){descriptor=value;return buffer;}};
  const encoder={copyTextureToBuffer(...args){copy=args;}};
  const texture={width:5,height:3,format:'rgba16float'};
  const capture=captureTexture(device,encoder,texture),result=await capture.read();
  assert.equal(descriptor.size,768);assert.equal(result.bytesPerRow,256);assert.equal(result.width,5);assert.equal(result.height,3);assert.deepEqual(copy[2],[5,3]);assert.ok(destroyed);
  assert.throws(()=>captureTexture({...device,limits:{maxBufferSize:100}},encoder,texture),/limit/);
  destroyed=false;buffer.mapAsync=async()=>{throw Error('device lost');};
  await assert.rejects(captureTexture(device,encoder,texture).read(),/device lost/);assert.ok(destroyed);
 }finally{
  if(previous.usage===undefined)delete globalThis.GPUBufferUsage;else globalThis.GPUBufferUsage=previous.usage;
  if(previous.map===undefined)delete globalThis.GPUMapMode;else globalThis.GPUMapMode=previous.map;
 }
});
