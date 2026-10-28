// Full-app progressive-loading regression with the first GEBCO range held until after preview and panning.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/gebco-app-browser.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {writeArrayBuffer} from '../vendor/geotiff/geotiff.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const width=512,height=256,values=new Float32Array(width*height);
for(let y=0;y<height;y++)for(let x=0;x<width;x++)values[y*width+x]=-5300+100*Math.sin(x/30)+y;
const tiff=Buffer.from(writeArrayBuffer(values,{width,height}));
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8123'},stdio:['ignore','pipe','inherit']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});
 const context=await browser.newContext({viewport:{width:1000,height:700},deviceScaleFactor:2});
 const page=await context.newPage(),errors=[],warnings=[];let ranges=0,sea=0;let release;const gate=new Promise(resolve=>{release=resolve;});
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='warning')warnings.push(message.text());});
 await page.addInitScript(()=>{
  window.terrainStages=[];window.terrainRequests=[];window.terrainUploads=[];window.gpuErrors=[];
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker{
   postMessage(data,...args){if(data.oceanSource)window.terrainRequests.push(data.oceanSource);return super.postMessage(data,...args);}
   constructor(url,options){super(url,options);if(String(url).includes('terrain.worker.js'))this.addEventListener('message',({data})=>{if(data.values)window.terrainStages.push({source:data.oceanSource,depth:data.values[0]});});}
  };
  const request=navigator.gpu.requestAdapter.bind(navigator.gpu);
  navigator.gpu.requestAdapter=async(...args)=>{const adapter=await request(...args),getDevice=adapter.requestDevice.bind(adapter);adapter.requestDevice=async(...args)=>{
   const device=await getDevice(...args),write=device.queue.writeTexture.bind(device.queue);
   device.addEventListener('uncapturederror',event=>window.gpuErrors.push(event.error.message));
   device.queue.writeTexture=(destination,values,...rest)=>{if(values instanceof Float32Array)window.terrainUploads.push(values[0]);return write(destination,values,...rest);};return device;
  };return adapter;};
 });
 const png=await page.evaluate(async()=>{const c=new OffscreenCanvas(512,512),ctx=c.getContext('2d');ctx.fillStyle='rgb(128,100,0)';ctx.fillRect(0,0,512,512);return Array.from(new Uint8Array(await(await c.convertToBlob()).arrayBuffer()));});
 await context.route('https://tiles.mapterhorn.com/**',route=>route.request().url().endsWith('.json')?route.fulfill({json:{tileSize:512,maxzoom:18,tiles:['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp']}}):route.fulfill({contentType:'image/png',body:Buffer.from(png)}));
 const seaPng=await page.evaluate(async()=>{const c=new OffscreenCanvas(512,512),ctx=c.getContext('2d');ctx.fillStyle='rgb(124,24,0)';ctx.fillRect(0,0,512,512);return Array.from(new Uint8Array(await(await c.convertToBlob()).arrayBuffer()));});
 await context.route('https://tiles.openwaters.io/**',route=>{if(route.request().url().endsWith('.json'))return route.fulfill({json:{tileSize:512,maxzoom:18,schema:1,tiles:['https://tiles.openwaters.io/seascape/{z}/{x}/{y}.webp']}});sea++;return route.fulfill({contentType:'image/png',body:Buffer.from(seaPng)});});
 await context.route('https://data.source.coop/**',async route=>{
  if(route.request().method()==='HEAD')return route.fulfill({status:200,headers:{etag:'"fixture-v1"','access-control-allow-origin':'*','access-control-expose-headers':'*'}});
  const [,a,b]=/^bytes=(\d+)-(\d+)$/.exec(route.request().headers().range);
  const start=Number(a),end=Math.min(Number(b),tiff.length-1);
  if(++ranges===1)await gate;
  await route.fulfill({status:206,headers:{etag:'"fixture-v1"','access-control-allow-origin':'*','access-control-expose-headers':'*','content-range':`bytes ${start}-${end}/${tiff.length}`},body:tiff.subarray(start,end+1)});
 });
 await page.goto('http://localhost:8123/#3.9501/0.3483970/0.3367455');
 async function complete(){await page.waitForFunction(()=>{const s=document.querySelector('#coverage').textContent.match(/^(\d+) \/ (\d+)/);return s&&Number(s[2])>0&&s[1]===s[2];},{},{timeout:45000});}
 await complete();
 await page.waitForFunction(()=>terrainStages.some(stage=>stage.source==='seascape'));
 assert.equal(await page.evaluate(()=>terrainStages.some(stage=>stage.source==='gebco')),false);
 await page.waitForFunction(()=>document.querySelector('#gebco-status').textContent.includes('Loading'));
 assert.match(await page.locator('#gebco-coverage').textContent(),/^0 \/ [1-9]\d*$/);
 assert.equal(await page.locator('#water').isChecked(),false);
 assert.ok(!(await page.locator('#message').textContent()).includes('Refining ocean'));
 assert.ok(await page.evaluate(()=>terrainUploads.includes(-1000)),'Seascape must be uploaded while GEBCO is blocked');
 await page.mouse.move(650,350);await page.mouse.down();await page.mouse.move(750,350,{steps:8});await page.mouse.up();
 await complete();
 const beforePause=await page.evaluate(()=>terrainRequests.filter(source=>source==='gebco').length);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 release();await page.waitForTimeout(500);
 assert.equal(await page.evaluate(()=>terrainRequests.filter(source=>source==='gebco').length),beforePause,'Hidden tab must start no new refinements');
 await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
 await page.waitForFunction(()=>terrainUploads.some(value=>value < -5000),{},{timeout:30000});
 assert.match(await page.locator('#gebco-coverage').textContent(),/^[1-9]\d* \/ [1-9]\d*$/);
 assert.ok(!(await page.locator('#message').textContent()).includes('Refining ocean'));
 await page.locator('#water').check();
 await page.locator('#projection').check();await complete();
 assert.ok(sea>0);assert.ok(await page.evaluate(()=>terrainStages.some(stage=>stage.source==='gebco')));assert.deepEqual(await page.evaluate(()=>gpuErrors),[]);assert.ok(ranges>0);assert.deepEqual(errors,[]);
 // Foreground WebP requests retain their original one-second retry policy.
 // Coverage and GPU uploads above verify that these retries do not block refinement.
 const stored=await page.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('elevation-atlas-resources',1);r.onsuccess=()=>resolve(r.result);r.onerror=reject;});
  const total=await new Promise(resolve=>{const r=db.transaction('meta').objectStore('meta').get('bytes');r.onsuccess=()=>resolve(r.result);});db.close();return total;
 });
 assert.ok(stored>0&&stored<=128*1024*1024,'Persistent resources must stay under their disk budget');
 const previousRanges=ranges;
 await page.reload();await complete();
 await page.waitForFunction(()=>terrainUploads.some(value=>value < -5000),{},{timeout:30000});
 assert.equal(ranges,previousRanges,'Reloaded GEBCO must reuse validated persistent bytes');
 console.log('PASS bounded persistent bytes survive reload; water-off refinement is silent; DPR-2 Seascape preview uploads before GEBCO, stays usable during pan, and is replaced on GPU; sphere renders without errors',{ranges,coverage:await page.locator('#coverage').textContent()});
}finally{await browser?.close();server.kill();}
