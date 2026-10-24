// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/map-webgpu.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mapFixture} from './vector-fixture.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8096'},stdio:['ignore','pipe','inherit']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});
 const page=await browser.newPage({viewport:{width:1200,height:820},deviceScaleFactor:2});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let mapRequests=0;
 await page.route('https://tiles.openfreemap.org/**',async route=>{mapRequests++;if(route.request().url().endsWith('/latest'))return route.fulfill({json:{minzoom:0,maxzoom:14,tiles:['https://tiles.openfreemap.org/fixture/{z}/{x}/{y}.pbf']}});return route.fulfill({body:Buffer.from(mapFixture()),contentType:'application/x-protobuf'});});
 await page.goto('http://127.0.0.1:8096');assert.equal(await page.locator('#map-mode').isChecked(),false);assert.equal(mapRequests,0);
 const maskResult=await page.evaluate(async()=>{
  const {MapOverlay}=await import('/map-overlay.js'),{sphereCamera}=await import('/sphere.js'),{createMapPass}=await import('/map-gpu.js');
  const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice(),gpuErrors=[];device.addEventListener('uncapturederror',e=>gpuErrors.push(e.error.message));const mapPass=await createMapPass(device);
  let options={view:{x:.515625,y:.515625,zoom:6},width:600,height:400,dpr:2,camera:null},result;
  const overlay=new MapOverlay(()=>{result=overlay.draw(options);},()=>{});await overlay.enable(true);result=overlay.draw(options);
  async function ready(){const start=performance.now();while(overlay.stats?.ready!==overlay.stats?.total||!overlay.stats?.total){if(performance.now()-start>10000)throw Error('Map fixture timed out');await new Promise(r=>setTimeout(r,20));}}
  function draw(){const encoder=device.createCommandEncoder(),output=mapPass.draw(encoder,result,1200,800);device.queue.submit([encoder.finish()]);return output;}
  async function read(texture){const width=texture.width,height=texture.height,row=Math.ceil(width*4/256)*256,buffer=device.createBuffer({size:row*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture},{buffer,bytesPerRow:row},[width,height]);device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);const source=new Uint8Array(buffer.getMappedRange()),data=new Uint8Array(width*height*4);for(let y=0;y<height;y++)data.set(source.subarray(y*row,y*row+width*4),y*width*4);buffer.unmap();buffer.destroy();return data;}
  await ready();const fontsReady=document.fonts.check('500 14px "Atlas Rajdhani"')&&document.fonts.check('400 12px "Atlas Plex Mono"');const flat={...overlay.stats},dims=[1200,800],output=draw(),bytes=await read(output.mask);let roads=0,ink=0,halo=0;for(let i=0;i<bytes.length;i+=4){if(bytes[i])roads++;if(bytes[i+1])ink++;if(bytes[i+2])halo++;}
  const glyphBytes=await read(output.labels),glyphPixels=glyphBytes.filter((v,i)=>i%4===3&&v>0).length;
  const revision=result.revision;overlay.draw(options);const stable=overlay.revision===revision;
  const uploads={...mapPass.stats};overlay.dirty=true;result=overlay.draw(options);draw();await device.queue.onSubmittedWorkDone();const cached=uploads.geometryUploads===mapPass.stats.geometryUploads&&uploads.glyphUploads===mapPass.stats.glyphUploads;
  options={...options,camera:sphereCamera(options.view,600,400,2,4)};result=overlay.draw(options);await ready();const sphere={...overlay.stats},globe=draw();const globePixels=await read(globe.mask),corner=Array.from(globePixels.slice(0,3));
  let nativeRevision=100000;const nativeChecks=[];
  for(const [sphere,latitude,seam] of [...[false,true].flatMap(sphere=>[0,40,80,-70].map(latitude=>[sphere,latitude,0])),[true,40,1],[true,40,-1]]){
   const n=2**14,initialY=(1-Math.log(Math.tan(Math.PI/4+latitude*Math.PI/360))/Math.PI)/2,tile={z:14,x:seam===1?0:seam===-1?n-1:10000,y:Math.floor(initialY*n)},cx=seam===1?-.003:seam===-1?1.003:.37123,cy=.52893,view={x:((tile.x+cx)/n+1)%1,y:(tile.y+cy)/n,zoom:19};
   const entry={geometry:{segments:new Float32Array([cx-.03,cy,cx+.03,cy,.65,0,0,1])}},entries=new Set([entry]);
   async function native(size,back=false){const camera=sphere?{...sphereCamera(view,size/2,size/2),radius:256*2**19/(2*Math.PI)}:null,scene={gpu:true,revision:++nativeRevision,fontRevision:1,width:size/2,height:size/2,dpr:2,camera,view,zoom:19,labels:[],entries,tiles:[{tile:back?{...tile,x:(tile.x+n/2)%n}:tile,entry}]},encoder=device.createCommandEncoder(),out=mapPass.draw(encoder,scene,size,size);device.queue.submit([encoder.finish()]);return read(out.mask);}
   const a=await native(256),b=await native(384);let difference=0;
   for(let y=-4;y<=4;y++)for(let x=-16;x<=16;x++)for(let c=0;c<3;c++)difference=Math.max(difference,Math.abs(a[((128+y)*256+128+x)*4+c]-b[((192+y)*384+192+x)*4+c]));
   const center=a[(128*256+128)*4];if(center<120||difference>1)throw Error(`Native GPU road projection/resize mismatch ${sphere}/${latitude}: ${center}, delta ${difference}`);
   if(sphere){const back=await native(256,true);if(back.some((value,i)=>i%4<3&&value!==0))throw Error('Back-hemisphere roads must be hidden');}
   nativeChecks.push({sphere,latitude,seam,center,difference});
  }
  mapPass.clear();await overlay.enable(false);await device.queue.onSubmittedWorkDone();return {fontsReady,flat,sphere,dims,roads,ink,halo,glyphPixels,nativeChecks,stable,cached,gpuErrors,corner,disabled:overlay.draw(options)===null};
 });
 assert.ok(maskResult.fontsReady);assert.deepEqual(maskResult.dims,[1200,800]);assert.ok(maskResult.roads>0&&maskResult.ink>0&&maskResult.halo>0);assert.ok(maskResult.flat.labels>0&&maskResult.sphere.labels>0);assert.ok(maskResult.stable&&maskResult.disabled&&maskResult.cached);assert.ok(maskResult.glyphPixels>0);assert.deepEqual(maskResult.gpuErrors,[]);assert.deepEqual(maskResult.corner,[0,0,0]);
 await page.waitForFunction(()=>document.querySelector('#hdr').textContent!=='Initializing');
 await page.locator('#map-mode').check();await page.waitForFunction(()=>document.querySelector('#map-status').textContent==='');await page.waitForTimeout(250);
 assert.deepEqual(errors,[]);await page.locator('#map-mode').uncheck();
 console.log('PASS map masks at full DPR, roads/borders/labels, worker decoding, collision labels, sphere clipping, reuse, toggle and disabled network behavior',maskResult);
 await page.unroute('https://tiles.openfreemap.org/**');
 if(process.env.LIVE_MAP){
  await page.goto('http://127.0.0.1:8096/#5/0.505/0.337');await page.reload();await page.locator('#map-mode').check();await page.waitForFunction(()=>document.querySelector('#level').textContent!=='—');await page.waitForFunction(()=>document.querySelector('#map-status').textContent==='',null,{timeout:30000});await page.waitForFunction(()=>parseInt(document.querySelector('#coverage').textContent)>0,null,{timeout:30000});await page.screenshot({path:'/tmp/elevation-map-flat.png'});
  await page.locator('#projection').check();await page.waitForFunction(()=>document.querySelector('#projection-label').textContent.includes('SPHERE'));await page.waitForFunction(()=>document.querySelector('#map-status').textContent==='',null,{timeout:30000});await page.screenshot({path:'/tmp/elevation-map-sphere.png'});assert.deepEqual(errors,[]);console.log('PASS live OpenFreeMap flat/sphere rendering and screenshots');
 }
}finally{await browser?.close();server.kill();}
