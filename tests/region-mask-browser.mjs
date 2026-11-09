// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/region-mask-browser.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8151'},stdio:['ignore','pipe','inherit']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});const page=await browser.newPage();
 await page.route('**/region-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto('http://localhost:8151/region-fixture');
 const result=await page.evaluate(async()=>{
  const {createRenderer}=await import('/gpu.js'),{sphereCamera}=await import('/sphere.js');
  const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice(),errors=[];device.addEventListener('uncapturederror',event=>errors.push(event.error.message));
  const canvas=document.createElement('canvas'),legend=document.createElement('canvas');canvas.width=canvas.height=128;legend.width=128;legend.height=8;
  const context=canvas.getContext('webgpu'),legendContext=legend.getContext('webgpu');for(const ctx of [context,legendContext])ctx.configure({device,format:'rgba8unorm',alphaMode:'opaque',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  const renderer=await createRenderer(device,'rgba8unorm',context,legendContext),texture=device.createTexture({size:[4,4],format:'rg32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC});
  const values=Float32Array.from({length:32},(_,i)=>i%2?1:0);device.queue.writeTexture({texture},values,{bytesPerRow:32},[4,4]);
  const image=new OffscreenCanvas(8,8),ctx=image.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,8,8);
  const mask={image:image.transferToImageBitmap(),revision:1,bounds:[.25,.25,.25,.5],reference:.375},view={x:.5,y:.5,zoom:0};
  const options={canvas,legend,tiles:[{key:'terrain',x:0,y:0,z:0,left:0,top:0,size:64}],cache:new Map([['terrain',{state:'ready',texture,size:4}]]),dpr:2,min:-1,max:1,palette:0,hdr:1,p3:0,edges:0,noOcean:false,emphasis:0,reduce:false,view};
  async function pixels(sphere,regionMask){renderer.invalidate();renderer.render({...options,sphere,regionMask,pinnedRegionRevision:1});const buffer=device.createBuffer({size:128*512,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:context.getCurrentTexture()},{buffer,bytesPerRow:512},[128,128]);device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);const data=new Uint8Array(buffer.getMappedRange()),sample=x=>Array.from(data.slice(64*512+x*4,64*512+x*4+3)),result={left:sample(48),right:sample(80)};buffer.unmap();buffer.destroy();return result;}
  const flat=await pixels(null,mask),sphere=await pixels(sphereCamera(view,64,64,2,0),mask),released=await pixels(null,null);
  await pixels(null,{...mask,revision:2,image:image.transferToImageBitmap()});
  const restored=await pixels(null,{...mask,image:null});
  if(JSON.stringify(restored)!==JSON.stringify(flat))throw Error('Pinned mask was not restored from GPU cache');
  for(let i=0;i<16;i++)values[i*2]=i%4<2?20:1000;device.queue.writeTexture({texture},values,{bytesPerRow:32},[4,4]);options.cache.get('terrain').textureVersion=1;
  async function exposure(regionMask,sphere=null){renderer.invalidate();return new Promise(resolve=>renderer.render({...options,sphere,regionMask,regionFilter:!!regionMask,reduce:true,onExposure:(lo,hi)=>resolve([lo,hi])}));}
  const allRange=await exposure(null),maskedRange=await exposure(mask),maskedSphereRange=await exposure(mask,sphereCamera(view,64,64,2,0));
  const faded=await pixels(null,{...mask,strength:.5});
  return {flat,sphere,released,faded,allRange,maskedRange,maskedSphereRange,errors};
 });
 for(const mode of ['flat','sphere']){assert.ok(result[mode].left[0]>20,`${mode} inside hidden`);assert.deepEqual(result[mode].right,[0,0,0],`${mode} outside visible`);}
 assert.ok(result.released.right[0]>20);assert.equal(result.allRange[1],1000);assert.equal(result.maskedRange[0],20);assert.ok(result.maskedRange[1]<600);assert.ok(result.maskedSphereRange[0]>=20&&result.maskedSphereRange[1]>20&&result.maskedSphereRange[1]<600);assert.ok(result.faded.right[0]>0&&result.faded.right[0]<255);assert.deepEqual(result.errors,[]);console.log('PASS geographic GPU mask at DPR 2, flat/sphere clipping, release and map-label independence',result);
 if(process.env.LIVE_REGIONS){
  const regions=await page.evaluate(async()=>{const worker=new Worker('/region-mask.worker.js',{type:'module'}),results=[];let id=0;try{for(const level of [2,1,0]){const data=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Boundary query timeout')),90000);worker.onmessage=({data})=>{clearTimeout(timer);resolve(data);};worker.onerror=reject;worker.postMessage({id:++id,longitude:-87.63,latitude:41.88,level});});if(data.error)throw Error(data.error);data.image?.close();results.push({name:data.name,level:data.level});}return results;}finally{worker.terminate();}});
  assert.deepEqual(regions.map(r=>r.level),[2,1,0]);assert.match(regions[0].name,/Cook/);assert.match(regions[1].name,/Illinois/);console.log('PASS live browser boundary data',regions);
 }
}finally{await browser?.close();server.kill();}
