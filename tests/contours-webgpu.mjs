// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/contours-webgpu.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8157'},stdio:['ignore','pipe','inherit']});await new Promise(r=>server.stdout.once('data',r));let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});const page=await browser.newPage();await page.route('**/contour-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto('http://localhost:8157/contour-fixture');
 const result=await page.evaluate(async()=>{
  const {createRenderer}=await import('/gpu.js'),adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice(),errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  const canvas=document.createElement('canvas'),legend=document.createElement('canvas');canvas.width=canvas.height=128;legend.width=32;legend.height=4;
  const context=canvas.getContext('webgpu'),legendContext=legend.getContext('webgpu');for(const ctx of [context,legendContext])ctx.configure({device,format:'rgba16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  const renderer=await createRenderer(device,'rgba16float',context,legendContext),texture=device.createTexture({size:[128,128],format:'rg32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  const values=new Float32Array(128*128*2),entry={state:'ready',size:128,texture};let version=0;
  function terrain(flat=false,water=false){for(let y=0;y<128;y++)for(let x=0;x<128;x++){const i=(y*128+x)*2;values[i]=flat?200:4*x;values[i+1]=water?-1:1;}device.queue.writeTexture({texture},values,{bytesPerRow:1024},[128,128]);entry.textureVersion=++version;renderer.invalidate();}
  const options={canvas,legend,tiles:[{key:'test',x:0,y:0,z:0,left:0,top:0,size:128}],cache:new Map([['test',entry]]),dpr:1,min:0,max:512,palette:1,hdr:4,p3:1,emphasis:0,edges:0,noOcean:false,contourInterval:50};
  const half=n=>{const sign=n&32768?-1:1,e=n>>>10&31,f=n&1023;return sign*(e===0?2**-14*f/1024:2**(e-15)*(1+f/1024));},decode=x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
  async function pixels(contours,extra={}){renderer.render({...options,contours,...extra});const buffer=device.createBuffer({size:128*1024,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:context.getCurrentTexture()},{buffer,bytesPerRow:1024},[128,128]);device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);const data=Array.from(new Uint16Array(buffer.getMappedRange()),half);buffer.unmap();buffer.destroy();return data;}
  terrain();const base=await pixels(false),contour=await pixels(true);let brighter=0,unchanged=0,maxRatioSpread=0;
  for(let x=8;x<120;x++){const i=(64*128+x)*4,a=base.slice(i,i+3).map(decode),b=contour.slice(i,i+3).map(decode);if(Math.max(...b)>Math.max(...a)*1.02){brighter++;const ratios=a.flatMap((v,k)=>v>.005?[b[k]/v]:[]);if(ratios.length>1)maxRatioSpread=Math.max(maxRatioSpread,Math.max(...ratios)-Math.min(...ratios));}else unchanged++;}
  async function legendPixels(contours){renderer.render({...options,contours});const buffer=device.createBuffer({size:1024,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:legendContext.getCurrentTexture()},{buffer,bytesPerRow:256},[32,4]);device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);const result=Array.from(new Uint16Array(buffer.getMappedRange()),half);buffer.unmap();buffer.destroy();return result;}
  const legendBase=await legendPixels(false),legendContour=await legendPixels(true),legendBrightened=legendContour.some((value,i)=>i%4<3&&value>legendBase[i]+.01);
  const outsideBase=await pixels(false,{min:600,max:800}),outsideContour=await pixels(true,{min:600,max:800});
  const rangeClipped=outsideBase.every((v,i)=>v===outsideContour[i]);
  const partialBase=await pixels(false,{min:128,max:384}),partialContour=await pixels(true,{min:128,max:384});
  let partialClipped=true;for(let x=0;x<128;x++)if(x<32||x>96){const i=(64*128+x)*4;for(let c=0;c<3;c++)if(partialBase[i+c]!==partialContour[i+c])partialClipped=false;}
  terrain(true);const flatBase=await pixels(false),flatContour=await pixels(true);
  terrain(false,true);const hiddenBase=await pixels(false,{noOcean:true}),hiddenContour=await pixels(true,{noOcean:true});
  await device.queue.onSubmittedWorkDone();return {rangeClipped,partialClipped,legendBrightened,brighter,unchanged,maxRatioSpread,flatEqual:flatBase.every((v,i)=>v===flatContour[i]),hiddenEqual:hiddenBase.every((v,i)=>v===hiddenContour[i]),errors};
 });
 assert.ok(result.brighter>5&&result.unchanged>5);assert.ok(result.maxRatioSpread<.03);assert.ok(result.flatEqual&&result.hiddenEqual&&result.legendBrightened&&result.rangeClipped&&result.partialClipped);assert.deepEqual(result.errors,[]);console.log('PASS GPU contours brighten without desaturation, preserve flat areas and obey hidden water',result);
}finally{await browser?.close();server.kill();}
