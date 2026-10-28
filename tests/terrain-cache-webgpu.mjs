// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/terrain-cache-webgpu.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8125'},stdio:['ignore','pipe','inherit']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});
 const page=await browser.newPage();await page.goto('http://localhost:8125/sphere-gpu.js');
 const result=await page.evaluate(async()=>{
  const {createSpherePass}=await import('/sphere-gpu.js'),{sphereCamera}=await import('/sphere.js');
  const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice(),errors=[];
  device.addEventListener('uncapturederror',event=>errors.push(event.error.message));
  const size=4,bytes=size*size*8;
  const pass=await createSpherePass(device,{historyBytes:bytes*2});
  const cache=new Map();
  for(const key of ['a','b','c']){
   const texture=device.createTexture({size:[size,size],format:'rg32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST});
   const values=new Float32Array(size*size*2);for(let i=0;i<values.length;i+=2){values[i]=600;values[i+1]=1;}
   device.queue.writeTexture({texture},values,{bytesPerRow:size*8},[size,size]);cache.set(key,{texture,textureVersion:1,state:'ready',size,values,used:0});
  }
  const target=device.createTexture({size:[64,64],format:'rg32float',usage:GPUTextureUsage.RENDER_ATTACHMENT});
  let clock=0;
  function draw(key){
   const e=cache.get(key);e.used=++clock;let uploads=0;
   const encoder=device.createCommandEncoder(),copy=encoder.copyTextureToTexture.bind(encoder);
   encoder.copyTextureToTexture=(source,...args)=>{if(source.texture===e.texture)uploads++;return copy(source,...args);};
   pass.draw(encoder,target.createView(),{camera:sphereCamera({x:.5,y:.5},64,64),tiles:[{key,z:0,x:0,y:0}],cache,noOcean:false,edges:false});
   device.queue.submit([encoder.finish()]);return uploads;
  }
  const counts=[draw('a'),draw('b'),draw('a'),draw('c'),draw('b')];
  await device.queue.onSubmittedWorkDone();const allocated=pass.memoryBytes(cache);
  pass.clear();target.destroy();for(const entry of cache.values())entry.texture.destroy();device.destroy();
  return {counts,allocated,errors};
 });
 assert.deepEqual(result.counts,[1,1,0,1,1],'Revisited atlas layers must be reused; LRU-evicted layers must be uploaded again');
 assert.deepEqual(result.errors,[]);console.log('PASS globe atlas retains recent layers and evicts LRU history under budget',result);
}finally{await browser?.close();server.kill();}
