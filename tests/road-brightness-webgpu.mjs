// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/road-brightness-webgpu.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8133'},stdio:['ignore','pipe','inherit']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/road-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Road shading fixture</title>'}));await page.goto('http://localhost:8133/road-fixture');
 const result=await page.evaluate(async()=>{
  const {createRenderer}=await import('/gpu.js'),adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice(),gpuErrors=[];
  device.addEventListener('uncapturederror',e=>gpuErrors.push(e.error.message));
  const canvas=document.createElement('canvas'),legend=document.createElement('canvas');canvas.width=canvas.height=32;legend.width=32;legend.height=2;
  const context=canvas.getContext('webgpu'),legendContext=legend.getContext('webgpu');
  for(const c of [context,legendContext])c.configure({device,format:'rgba16float',colorSpace:'display-p3',toneMapping:{mode:'extended'},usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  const renderer=await createRenderer(device,'rgba16float',context,legendContext);
  const texture=device.createTexture({size:[4,4],format:'rg32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),values=new Float32Array(32);
  const mask=new OffscreenCanvas(32,32),ctx=mask.getContext('2d');let revision=0;
  const half=n=>{const sign=n&32768?-1:1,e=n>>>10&31,f=n&1023;return sign*(e===0?2**-14*f/1024:2**(e-15)*(1+f/1024));};
  const decode=x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
  async function sample(t,{water=false,coverage=255,roads=true}={}){
   for(let i=0;i<values.length;i+=2){values[i]=t;values[i+1]=water?-1:1;}
   device.queue.writeTexture({texture},values,{bytesPerRow:32},[4,4]);ctx.fillStyle=`rgb(${coverage},0,0)`;ctx.fillRect(0,0,32,32);
   renderer.invalidate();renderer.render({tiles:[{key:'tile',left:0,top:0,size:32}],cache:new Map([['tile',{state:'ready',texture,size:4}]]),dpr:1,canvas,legend,min:0,max:1,palette:0,hdr:2,p3:1,emphasis:false,edges:0,noOcean:water,reduce:false,mapOverlay:roads?{canvas:mask,revision:++revision}:null});
   const buffer=device.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:context.getCurrentTexture(),origin:[16,16]},{buffer,bytesPerRow:256},[1,1]);device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);const value=decode(half(new Uint16Array(buffer.getMappedRange())[0]));buffer.unmap();buffer.destroy();return value;
  }
  const checks=[];
  for(const t of [0,.2,.5,1]){
   const measured=await sample(t),Y=decode(t),expected=Math.max(.08,Y*(3-Math.min(1,Y)));
   if(Math.abs(measured-expected)>.004)throw Error(`Road brightness ${t}: ${measured} vs ${expected}`);
   checks.push({t,measured,expected});
  }
  const hidden=await sample(.5,{water:true}),hiddenBase=await sample(.5,{water:true,roads:false}),partial=await sample(.5,{water:true,coverage:128});
  if(Math.abs(hidden-.08)>.002)throw Error('Hidden-water road floor');
  if(Math.abs(partial-(hiddenBase*(1-128/255)+.08*128/255))>.002)throw Error('Road mask must retain antialiasing');
  await device.queue.onSubmittedWorkDone();texture.destroy();return {checks,hidden,partial,gpuErrors};
 });
 assert.deepEqual(errors,[]);assert.deepEqual(result.gpuErrors,[]);console.log('PASS road luminance floor, adaptive dark-to-white gain, HDR output, hidden water, and coverage blending',result);
}finally{await browser?.close();server.kill();}
