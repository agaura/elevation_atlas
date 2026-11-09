// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/planetary-labels-browser.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8148'},stdio:['ignore','pipe','inherit']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});
 const page=await browser.newPage(),errors=[],catalogRequests=[],external=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(/-names\.json/.test(request.url()))catalogRequests.push(request.url());if(!request.url().startsWith('http://localhost:8148'))external.push(request.url());});
 await page.route('**/label-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>@font-face{font-family:"Atlas Rajdhani";src:url(/fonts/Rajdhani-Medium.ttf);font-weight:500}@font-face{font-family:"Atlas Plex Mono";src:url(/fonts/IBMPlexMono-Regular.ttf);font-weight:400}</style>'}));
 await page.goto('http://localhost:8148/label-fixture');
 const result=await page.evaluate(async()=>{
  const {MapOverlay}=await import('/map-overlay.js'),{mercatorY}=await import('/planetary.js'),{sphereCamera}=await import('/sphere.js'),{createMapPass}=await import('/map-gpu.js');
  const overlay=new MapOverlay(()=>{},()=>{}),adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice(),gpuErrors=[];
  device.addEventListener('uncapturederror',event=>gpuErrors.push(event.error.message));
  const pass=await createMapPass(device),results=[];
  for(const [body,name,lon,lat] of [['mars','Olympus Mons',-133.8025,18.6528],['moon','Tycho',-11.2153,-43.2958]]){
   overlay.setBody(body);await overlay.enable(true);
   const width=900,height=700,dpr=2,view={x:lon/360+.5,y:mercatorY(lat),zoom:6};
   for(const sphere of [false,true]){
    overlay.dirty=true;const camera=sphere?sphereCamera(view,width,height,dpr,3):null;
    const scene=overlay.draw({view,width,height,dpr,camera});
    if(!scene.labels.some(label=>label.name===name))throw Error(`${body} ${sphere?'sphere':'flat'} missing ${name}`);
    if(scene.tiles.length||scene.entries.size)throw Error('Planetary labels should not load Earth tiles');
    const encoder=device.createCommandEncoder();pass.draw(encoder,scene,width*dpr,height*dpr);device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();
    results.push({body,sphere,labels:scene.labels.length,named:name});
   }
   await overlay.enable(false);if(overlay.draw({})!==null)throw Error('Disabled label layer remained visible');await overlay.enable(true);
  }
  pass.clear();await overlay.enable(false);return {results,gpuErrors};
 });
 assert.deepEqual(result.gpuErrors,[]);assert.deepEqual(errors,[]);assert.equal(catalogRequests.length,2);assert.deepEqual(external,[]);
 console.log('PASS on-demand catalogs, flat/sphere named features, GPU labels, cached toggles and no external requests',result);
}finally{await browser?.close();server.kill();}
