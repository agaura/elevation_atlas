// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tests/hdr-export-webgpu.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8108'},stdio:['ignore','pipe','inherit']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});
 const page=await browser.newPage({viewport:{width:640,height:480},deviceScaleFactor:2,acceptDownloads:true}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/gtag/**',route=>route.abort());
 await page.route(/https:\/\/tiles\.(mapterhorn\.com|openwaters\.io)\/.*json$/,route=>route.fulfill({json:{tiles:['https://fixture.invalid/{z}/{x}/{y}'],tileSize:512,maxzoom:18,schema:1}}));
 await page.addInitScript(()=>{
  const NativeWorker=window.Worker;window.exportWorkers=0;
  window.Worker=class{
   constructor(url,options){if(!String(url).includes('terrain.worker.js')){window.exportWorkers++;return new NativeWorker(url,options);}}
   postMessage(message){if(message.cancel)return;const size=16,values=new Float32Array(size*size*2);for(let i=0;i<values.length;i+=2){values[i]=600.125;values[i+1]=1;}setTimeout(()=>this.onmessage({data:{id:message.id,size,values}}),5);}
  };
  window.gpuErrors=[];const request=navigator.gpu.requestAdapter.bind(navigator.gpu);navigator.gpu.requestAdapter=async(...args)=>{const adapter=await request(...args),getDevice=adapter.requestDevice.bind(adapter);adapter.requestDevice=async(...args)=>{const device=await getDevice(...args);device.addEventListener('uncapturederror',e=>window.gpuErrors.push(e.error.message));return device;};return adapter;};
 });
 await page.goto('http://127.0.0.1:8108/#5/.5/.42',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#level').textContent!=='—');await page.waitForTimeout(800);
 assert.equal(await page.evaluate(()=>exportWorkers),0,'Encoder must remain lazy');
 await page.locator('#edges').uncheck();await page.selectOption('#palette','0');await page.locator('#highlight').check();await page.locator('#highlight-elevation-number').fill('600.125');await page.locator('#highlight-elevation-number').dispatchEvent('input');await page.waitForTimeout(600);
 for(const sphere of [false,true]){
  if(sphere){await page.locator('#projection').check();await page.locator('#fullscreen').click();await page.waitForFunction(()=>!document.querySelector('#fullscreen-download').hidden);await page.waitForTimeout(500);}
  const dimensions=await page.locator('#map').evaluate(e=>({width:e.width,height:e.height,cssWidth:e.clientWidth}));
  const downloadPromise=page.waitForEvent('download',{timeout:120000});await page.locator(sphere?'#fullscreen-download':'#download').click();
  const download=await downloadPromise;assert.match(download.suggestedFilename(),new RegExp(`${dimensions.width}x${dimensions.height}-hdr\\.avif$`));
  const bytes=new Uint8Array(await readFile(await download.path()));
  const decoded=await page.evaluate(async({bytes})=>{
   const decoder=new ImageDecoder({data:new Uint8Array(bytes),type:'image/avif',colorSpaceConversion:'default'});
   const {image}=await decoder.decode();const result={width:image.displayWidth,height:image.displayHeight,format:image.format,colorSpace:image.colorSpace.toJSON()};
   const raw=new Uint8Array(image.allocationSize()),layout=await image.copyTo(raw);result.layout=layout;
   if(image.format==='I444P12'){const plane=new DataView(raw.buffer);result.middle=layout.map(p=>plane.getUint16(p.offset+Math.floor(image.codedHeight/2)*p.stride+Math.floor(image.codedWidth/2)*2,true));}
   image.close();decoder.close();return result;
  },{bytes:Array.from(bytes)});
  assert.equal(decoded.width,dimensions.width);assert.equal(decoded.height,dimensions.height);assert.equal(dimensions.width,dimensions.cssWidth*2);
  assert.equal(decoded.colorSpace.primaries,'smpte432');assert.ok(['pq','smpte2084'].includes(decoded.colorSpace.transfer));assert.ok(decoded.colorSpace.matrix===null||decoded.colorSpace.matrix==='rgb');assert.equal(decoded.colorSpace.fullRange,true);
  assert.equal(decoded.format,'I444P12');assert.ok(decoded.middle.every(value=>value>2378&&value<4095),'HDR samples must remain above reference white without clipping');
  assert.equal(await page.locator('#download').isEnabled(),true);assert.match(await page.locator('#export-status').textContent(),/saved/);
  console.log('PASS full-device-resolution HDR AVIF download', {sphere,bytes:bytes.length,...decoded});
  if(sphere){await page.locator('#fullscreen-exit').click();await page.waitForFunction(()=>document.querySelector('#fullscreen-download').hidden);}
 }
 await page.setViewportSize({width:320,height:800});await page.waitForTimeout(150);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.ok(await page.locator('#download').evaluate(e=>{const box=e.getBoundingClientRect(),header=e.closest('header').getBoundingClientRect();return box.left>=0&&box.right<=innerWidth&&box.bottom<=header.bottom;}));
 await page.screenshot({path:'/tmp/elevation-download-mobile.png',fullPage:true});
 const fallback=await page.evaluate(async()=>{
  const {createRenderer}=await import('/gpu.js'),{prepareHdrPixels,halfToFloat}=await import('/hdr-pixels.js');
  const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice();
  const canvas=document.createElement('canvas'),legend=document.createElement('canvas');canvas.width=5;canvas.height=3;legend.width=5;legend.height=1;
  const context=canvas.getContext('webgpu'),legendContext=legend.getContext('webgpu');for(const ctx of [context,legendContext])ctx.configure({device,format:'rgba8unorm',colorSpace:'display-p3',alphaMode:'opaque'});
  const renderer=await createRenderer(device,'rgba8unorm',context,legendContext),texture=device.createTexture({size:[4,4],format:'rg32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
  const values=new Float32Array(32);for(let i=0;i<values.length;i+=2){values[i]=600;values[i+1]=1;}device.queue.writeTexture({texture},values,{bytesPerRow:32},[4,4]);
  const promise=renderer.capture();renderer.render({tiles:[{key:'tile',left:0,top:0,size:5}],cache:new Map([['tile',{state:'ready',texture,size:4}]]),dpr:1,canvas,legend,min:0,max:1000,palette:1,hdr:2,p3:1,emphasis:true,selectedElevation:600,highlightWidth:100,edges:0,noOcean:false,reduce:false});
  const frame=await promise,expected=prepareHdrPixels(frame).data;
  const encoded=await new Promise((resolve,reject)=>{const worker=new Worker('/image-export.worker.js',{type:'module'});worker.onmessage=({data})=>{if(data.status)return;worker.terminate();if(data.error)reject(Error(data.error));else resolve(data.bytes);};worker.onerror=e=>{worker.terminate();reject(Error(e.message));};worker.postMessage(frame,[frame.pixels.buffer]);});
  const decoder=new ImageDecoder({data:encoded,type:'image/avif'}),{image}=await decoder.decode();
  const bytes=new Uint8Array(image.allocationSize()),layout=await image.copyTo(bytes),view=new DataView(bytes.buffer);
  // Identity matrix stores planes as G, B, R. Compare all odd-sized rows/pixels.
  for(let y=0;y<3;y++)for(let x=0;x<5;x++)for(let plane=0;plane<3;plane++){
   const actual=view.getUint16(layout[plane].offset+y*layout[plane].stride+x*2,true),channel=[1,2,0][plane];
   if(actual!==expected[(y*5+x)*4+channel])throw Error('12-bit AVIF samples changed during lossless encoding');
  }
  const result={width:image.displayWidth,height:image.displayHeight,format:frame.format,peak:Math.max(...expected.filter((_,index)=>index%4!==3))};
  image.close();decoder.close();texture.destroy();return result;
 });
 assert.deepEqual([fallback.width,fallback.height],[5,3]);assert.equal(fallback.format,'rgba16float');assert.ok(fallback.peak>2378,'Colored HDR export must retain values above reference white');
 console.log('PASS float export from SDR canvas fallback, odd dimensions, and exact 12-bit sample round-trip',fallback);
 assert.deepEqual(await page.evaluate(()=>gpuErrors),[]);assert.deepEqual(errors,[]);
}finally{await browser?.close();server.kill();}
