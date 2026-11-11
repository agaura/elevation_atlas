// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/imagery-webgpu.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8159'},stdio:['ignore','pipe','inherit']});await new Promise(r=>server.stdout.once('data',r));let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});const page=await browser.newPage();await page.route('**/imagery-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto('http://localhost:8159/imagery-fixture');
 const result=await page.evaluate(async()=>{
  const {createRenderer}=await import('/gpu.js'),{sphereCamera}=await import('/sphere.js'),{IMAGERY_SOURCES}=await import('/imagery.js');
  const device=await (await navigator.gpu.requestAdapter()).requestDevice(),errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  const canvas=document.createElement('canvas'),legend=document.createElement('canvas');canvas.width=canvas.height=128;legend.width=32;legend.height=4;
  const context=canvas.getContext('webgpu'),legendContext=legend.getContext('webgpu');for(const ctx of [context,legendContext])ctx.configure({device,format:'rgba16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  const renderer=await createRenderer(device,'rgba16float',context,legendContext);
  const image=device.createTexture({size:[2,2],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});device.queue.writeTexture({texture:image},Uint8Array.from(Array.from({length:4},()=>[51,102,153,255]).flat()),{bytesPerRow:8},[2,2]);
  const half=n=>{const sign=n&32768?-1:1,e=n>>>10&31,f=n&1023;return sign*(e===0?2**-14*f/1024:2**(e-15)*(1+f/1024));};
  const checks=[];
  const dem=device.createTexture({size:[128,128],format:'rg32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  const heights=new Float32Array(128*128*2);for(let i=0;i<heights.length;i+=2){heights[i]=50;heights[i+1]=1;}
  device.queue.writeTexture({texture:dem},heights,{bytesPerRow:1024},[128,128]);
  const demTiles=[{key:'dem',x:0,y:0,z:0,left:0,top:0,size:128}],demCache=new Map([['dem',{state:'ready',size:128,texture:dem}]]);
  let revision=0;
  async function render(body,sphere,view={x:.25,y:.5,zoom:0},fine=false,gap=false){
   const camera=sphere?sphereCamera(view,128,128,1,0):null;if(camera&&fine)camera.radius=256*2**view.zoom/(2*Math.PI);
   const source=IMAGERY_SOURCES[body],tiles=[{tile:{z:0,x:0,y:0},texture:image}];if(source.geographic)tiles.push({tile:{z:0,x:1,y:0},texture:image});if(fine){const z=19;tiles.push({tile:{z,x:Math.floor(view.x*2**z),y:Math.floor(view.y*2**z)},texture:image});}
   renderer.invalidate();renderer.render({canvas,legend,tiles:gap?demTiles:[],cache:gap?demCache:new Map(),dpr:1,min:0,max:100,palette:1,hdr:4,p3:0,edges:1,emphasis:0,noOcean:true,sphere:camera,view,imagery:{tiles:gap?[]:tiles,source,view,dpr:1,camera,revision:++revision}});
   const buffer=device.createBuffer({size:131072,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:context.getCurrentTexture()},{buffer,bytesPerRow:1024},[128,128]);device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);const data=new Uint16Array(buffer.getMappedRange()),center=Array.from(data.slice((64*128+64)*4,(64*128+64)*4+3),half),corner=Array.from(data.slice(0,3),half);buffer.unmap();buffer.destroy();return {body,sphere,fine,center,corner};
  }
  for(const body of ['earth','mars','moon'])for(const sphere of [false,true])checks.push(await render(body,sphere));
  for(const sphere of [false,true])checks.push(await render('earth',sphere,{x:.5000007,y:.378579,zoom:19},true));
  const gap=await render('moon',false,{x:.25,y:.5,zoom:0},false,true);
  await device.queue.onSubmittedWorkDone();return {checks,gap,errors};
 });
 for(const check of result.checks){for(let i=0;i<3;i++)assert.ok(Math.abs(check.center[i]-[.2,.4,.6][i])<.01,JSON.stringify(check));if(check.sphere&&!check.fine)assert.ok(Math.max(...check.corner)<.03);}
 assert.ok(Math.max(...result.gap.center)<.03,'Pending/missing satellite tiles must hide valid terrain');
 assert.deepEqual(result.errors,[]);console.log('PASS imagery projections for all bodies, high zoom precision, SDR/P3 conversion, globe clipping and terrain-independent loading',result);
 if(process.env.LIVE_IMAGERY){
  const live=await page.evaluate(async()=>{
   const {IMAGERY_SOURCES}=await import('/imagery.js'),results=[];
   for(const [body,source] of Object.entries(IMAGERY_SOURCES)){
    const start=performance.now(),url=source.url.replace('{z}',0).replace('{y}',0).replace('{x}',0),response=await fetch(url,{signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error(`${body}: HTTP ${response.status}`);
    const bitmap=await createImageBitmap(await response.blob(),{colorSpaceConversion:'none'}),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    if(!pixels.some((v,i)=>i%4!==3&&v>0))throw Error(`${body}: empty image`);
    results.push({body,width:bitmap.width,height:bitmap.height,seconds:(performance.now()-start)/1000});bitmap.close();
   }
   return results;
  });console.log('PASS live Earth, Mars and Moon image delivery, CORS and decoding',live);
 }

}finally{await browser?.close();server.kill();}
