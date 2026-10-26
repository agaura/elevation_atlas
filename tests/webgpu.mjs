// Optional integration checks: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tests/webgpu.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8095'},stdio:['ignore','pipe','inherit']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(Error('Server exited '+code)));});
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});
 if(!process.env.ZOOM_ONLY){
 const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:3});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});
 await page.goto('http://127.0.0.1:8095');
 const result=await page.evaluate(async()=>{
  // Exercise real image decode + merge in the worker, including a lake shore.
  async function tileBlob(heights){const c=new OffscreenCanvas(4,4),ctx=c.getContext('2d'),image=ctx.createImageData(4,4);for(let i=0;i<16;i++){const encoded=Math.round((heights[i%4]+32768)*256);image.data.set([encoded>>>16&255,encoded>>>8&255,encoded&255,255],i*4);}ctx.putImageData(image,0,0);return URL.createObjectURL(await c.convertToBlob({type:'image/png'}));}
  const landURL=await tileBlob([600,610,620,630]),seaURL=await tileBlob([0,1,2,-15]);
  const worker=new Worker('/terrain.worker.js',{type:'module'});
  const shoreline=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Worker fixture timeout')),10000);worker.onmessage=({data})=>{clearTimeout(timer);data.error?reject(Error(data.error)):resolve(Array.from(data.values.slice(0,8)));};worker.onerror=reject;worker.postMessage({id:1,t:{x:0,y:0,z:0},metadata:{land:{tiles:[landURL]},sea:{tiles:[seaURL]}}});});
  worker.terminate();URL.revokeObjectURL(landURL);URL.revokeObjectURL(seaURL);
  const {createRenderer}=await import('/gpu.js');const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice();const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  const canvas=document.createElement('canvas'),legend=document.createElement('canvas');canvas.width=canvas.height=32;legend.width=32;legend.height=2;
  const context=canvas.getContext('webgpu'),legendContext=legend.getContext('webgpu');for(const ctx of [context,legendContext])ctx.configure({device,format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC,alphaMode:'opaque'});
  const renderer=await createRenderer(device,'rgba8unorm',context,legendContext);const values=new Float32Array(4*4*2);for(let y=0;y<4;y++)for(let x=0;x<4;x++){const i=(y*4+x)*2;values[i]=x===0?-50:x===2?900:x===1?1500:500;values[i+1]=x===1?-1:1;} // negative LAND in column 0; WATER in column 1.
  const texture=device.createTexture({size:[4,4],format:'rg32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC});device.queue.writeTexture({texture},values,{bytesPerRow:32},[4,4]);const options={tiles:[{key:'tile',x:0,y:0,z:0,left:0,top:0,size:32}],cache:new Map([['tile',{state:'ready',texture,size:4}]]),dpr:1,canvas,legend,min:-100,max:2000,palette:0,hdr:1,p3:0,selected:.5,emphasis:false,edges:0,noOcean:false,reduce:true};
  async function exposure(noOcean){renderer.invalidate();return new Promise(resolve=>renderer.render({...options,noOcean,onExposure:(lo,hi)=>resolve([lo,hi])}));}
  const all=await exposure(false),land=await exposure(true);
  async function pixels(edges,min=-100,overrides={}){renderer.invalidate();renderer.render({...options,edges,min,reduce:false,...overrides});const buffer=device.createBuffer({size:32*256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:context.getCurrentTexture()},{buffer,bytesPerRow:256},[32,32]);device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);const data=new Uint8Array(buffer.getMappedRange()).slice();buffer.unmap();buffer.destroy();return data;}
  for(let i=1;i<values.length;i+=2)values[i]=1;device.queue.writeTexture({texture},values,{bytesPerRow:32},[4,4]);
  const fallbackSettings={tiles:[{...options.tiles[0],sourceKey:'tile',uv:[0,0,1]}]};
  const fallbackOff=await pixels(0,-100,fallbackSettings),fallbackOn=await pixels(1,-100,fallbackSettings);
  if(!fallbackOff.every((v,i)=>v===fallbackOn[i]))throw Error('Temporary parent previews must not receive edge enhancement');
  const off=await pixels(0),on=await pixels(1),shifted=await pixels(0,-1000);const at=(data,x)=>data[16*256+x*4];
  for(let y=0;y<4;y++)for(let x=0;x<4;x++){values[(y*4+x)*2]=-400+300*x;values[(y*4+x)*2+1]=1;}device.queue.writeTexture({texture},values,{bytesPerRow:32},[4,4]);
  const cutoffOff=await pixels(0,0,{palette:1}),cutoffOn=await pixels(1,0,{palette:1});
  const brightness=(data,x)=>data[16*256+x*4]+data[16*256+x*4+1]+data[16*256+x*4+2];
  if(brightness(cutoffOn,15)<=brightness(cutoffOff,15))throw Error('Edge highlighting must not abruptly switch off when a slope crosses the exposure minimum');
  for(let i=0;i<values.length;i+=2){values[i]=600;values[i+1]=1;}device.queue.writeTexture({texture},values,{bytesPerRow:32},[4,4]);
  for(const palette of [0,1,2,3,4]){
   const reverse=await pixels(0,-100,{palette,reversed:true,emphasis:false});
   const equivalent=await pixels(0,-800,{palette,max:1300,emphasis:false});
   if(!reverse.every((v,i)=>Math.abs(v-equivalent[i])<=1))throw Error('Palette reversal must map t to 1-t in every palette');
   const peak=await pixels(0,-100,{palette,reversed:true,emphasis:true,selectedElevation:600,highlightWidth:100});
   if(peak.every((v,i)=>v===reverse[i]))throw Error('Reversing the palette must retain the highlight elevation');
  }
  const mask=new OffscreenCanvas(32,32),maskContext=mask.getContext('2d',{alpha:false});maskContext.fillStyle='black';maskContext.fillRect(0,0,32,32);maskContext.fillStyle='red';maskContext.fillRect(0,0,10,32);maskContext.fillStyle='#00ff00';maskContext.fillRect(10,0,10,32);maskContext.fillStyle='blue';maskContext.fillRect(20,0,12,32);
  const mapBase=await pixels(0,-100,{palette:1}),mapOn=await pixels(0,-100,{palette:1,mapOverlay:{canvas:mask,revision:1}});
  const mapRGB=(data,x)=>Array.from(data.slice(16*256+x*4,16*256+x*4+3));
  const road=mapRGB(mapOn,5),baseRoad=mapRGB(mapBase,5),halo=mapRGB(mapOn,25),baseHalo=mapRGB(mapBase,25);
  if(road.reduce((a,b)=>a+b)<=baseRoad.reduce((a,b)=>a+b))throw Error('Road mask must brighten terrain');
  if((Math.max(...road)-Math.min(...road))/road.reduce((a,b)=>a+b)>=(Math.max(...baseRoad)-Math.min(...baseRoad))/baseRoad.reduce((a,b)=>a+b))throw Error('Road mask must desaturate terrain');
  if(!(mapRGB(mapOn,15)[2]>mapRGB(mapOn,15)[0]&&mapRGB(mapOn,15)[1]>mapRGB(mapOn,15)[0]))throw Error('Borders must use the cool-blue UI palette');
  if(halo.reduce((a,b)=>a+b)>=baseHalo.reduce((a,b)=>a+b))throw Error('Label halos must darken terrain');
  const roadLow=await pixels(0,-100,{palette:0,mapOverlay:{canvas:mask,revision:1}}),roadHigh=await pixels(0,-1000,{palette:0,mapOverlay:{canvas:mask,revision:1}});
  if(mapRGB(roadHigh,5)[0]-mapRGB(roadLow,5)[0]<30)throw Error('Road brightness must retain underlying terrain variation rather than converge to fixed gray');
  const glyphs=new OffscreenCanvas(32,32),glyphCtx=glyphs.getContext('2d');glyphCtx.fillStyle='#8fc5ff';glyphCtx.fillRect(2,0,6,32);
  const opaqueA=await pixels(0,-100,{palette:1,mapOverlay:{canvas:mask,labels:glyphs,revision:4}}),opaqueB=await pixels(1,-1000,{palette:2,mapOverlay:{canvas:mask,labels:glyphs,revision:5}});
  if(!mapRGB(opaqueA,5).every((v,i)=>Math.abs(v-mapRGB(opaqueB,5)[i])<=1))throw Error('Opaque labels must sit above roads, exposure, palettes and edges');
  const monochrome=await pixels(0,-100,{palette:0,mapOverlay:{canvas:mask,labels:glyphs,revision:6}});
  for(const x of [5,15,25]){const rgb=mapRGB(monochrome,x);if(Math.max(...rgb)-Math.min(...rgb)>1)throw Error('Grayscale map labels, borders and halos must be neutral');}
  const hdrCanvas=document.createElement('canvas'),hdrLegend=document.createElement('canvas');hdrCanvas.width=hdrCanvas.height=32;hdrLegend.width=32;hdrLegend.height=2;
  const hdrContext=hdrCanvas.getContext('webgpu'),hdrLegendContext=hdrLegend.getContext('webgpu');for(const ctx of [hdrContext,hdrLegendContext])ctx.configure({device,format:'rgba16float',colorSpace:'display-p3',toneMapping:{mode:'extended'},usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC,alphaMode:'opaque'});
  const hdrRenderer=await createRenderer(device,'rgba16float',hdrContext,hdrLegendContext);
  const half=n=>{const sign=n&32768?-1:1,e=n>>>10&31,f=n&1023;return sign*(e===0?2**-14*f/1024:e===31?Infinity:2**(e-15)*(1+f/1024));};
  const srgbToLinear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
  async function hdrMapPixel(palette,x){
   hdrRenderer.render({...options,canvas:hdrCanvas,legend:hdrLegend,palette,hdr:2,p3:1,reduce:false,mapOverlay:{canvas:mask,labels:glyphs,revision:10}});
   const buffer=device.createBuffer({size:32*256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:hdrContext.getCurrentTexture()},{buffer,bytesPerRow:256},[32,32]);device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);const data=new Uint16Array(buffer.getMappedRange()),rgb=Array.from(data.slice(16*128+x*4,16*128+x*4+3),half);buffer.unmap();buffer.destroy();return rgb;
  }
  for(const x of [5,15]){
   const rgb=await hdrMapPixel(1,x),linear=rgb.map(srgbToLinear),luminance=linear[0]*.2289746+linear[1]*.6917385+linear[2]*.0792869;
   if(rgb[2]<=1||Math.abs(luminance-1.15)>.015)throw Error(`HDR blue map ink must match white luminance: ${rgb}, Y=${luminance}`);
   const gray=await hdrMapPixel(0,x);if(Math.max(...gray)-Math.min(...gray)>.002)throw Error('HDR grayscale map ink must remain neutral');
  }
  const mapAfter=await pixels(0,-100,{palette:1});if(!mapAfter.every((v,i)=>v===mapBase[i]))throw Error('Disabling map mode must restore original terrain');
  renderer.invalidate();const mapExposure=await new Promise(resolve=>renderer.render({...options,mapOverlay:{canvas:mask,revision:2},reduce:true,onExposure:(lo,hi)=>resolve([lo,hi])}));if(mapExposure[0]!==600||mapExposure[1]!==600)throw Error('Map overlay must not affect elevation exposure');
  const missingTerrainMap=await pixels(0,-100,{tiles:[],cache:new Map(),mapOverlay:{canvas:mask,revision:3}});if(mapRGB(missingTerrainMap,15)[2]<200)throw Error('Labels and borders must remain visible over hidden water or missing terrain');

  const highlightChecks=[];
  for(const palette of [0,1,2,3,4]){
   const settings={palette,edges:0,selectedElevation:600,highlightWidth:100};
   const base=await pixels(0,-100,{...settings,emphasis:false}),peak=await pixels(0,-100,{...settings,emphasis:true});
   const end=await pixels(0,-100,{...settings,selectedElevation:700,emphasis:true});
   const narrow=await pixels(0,-100,{...settings,selectedElevation:800,emphasis:true});
   const broad=await pixels(0,-100,{...settings,selectedElevation:800,highlightWidth:400,emphasis:true});
   const rgb=data=>Array.from(data.slice(16*256+11*4,16*256+11*4+3));
   highlightChecks.push({palette,base:rgb(base),peak:rgb(peak),end:rgb(end),narrow:rgb(narrow),broad:rgb(broad)});
  }
  const {sphereCamera}=await import('/sphere.js');const camera=sphereCamera({x:.5,y:.5},32,32);
  const globe=await pixels(0,-100,{sphere:camera});const globeCenter=Array.from(globe.slice(16*256+16*4,16*256+16*4+3)),globeCorner=Array.from(globe.slice(0,3));
  renderer.invalidate();const globeExposure=await new Promise(resolve=>renderer.render({...options,sphere:camera,reduce:true,onExposure:(lo,hi)=>resolve([lo,hi])}));
  const quadrantTiles=[],quadrantCache=new Map();for(let y=0;y<2;y++)for(let x=0;x<2;x++){const key=`1/${x}/${y}`,data=new Float32Array(32);for(let i=0;i<32;i+=2){data[i]=100*(1+x+2*y);data[i+1]=1;}const texture=device.createTexture({size:[4,4],format:'rg32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC});device.queue.writeTexture({texture},data,{bytesPerRow:32},[4,4]);quadrantTiles.push({x,y,z:1,key});quadrantCache.set(key,{state:'ready',texture,size:4});}
  renderer.invalidate();const quadrantExposure=await new Promise(resolve=>renderer.render({...options,tiles:quadrantTiles,cache:quadrantCache,sphere:camera,reduce:true,onExposure:(lo,hi)=>resolve([lo,hi])}));
  for(let y=0;y<4;y++)for(let x=0;x<4;x++){values[(y*4+x)*2]=100*(x+1);values[(y*4+x)*2+1]=1;}device.queue.writeTexture({texture},values,{bytesPerRow:32},[4,4]);
  renderer.invalidate();const parentExposure=await new Promise(resolve=>renderer.render({...options,tiles:[{key:'child',sourceKey:'parent',left:0,top:0,size:32,uv:[.5,0,.5]}],cache:new Map([['parent',{state:'ready',texture,size:4}]]),reduce:true,onExposure:(lo,hi)=>resolve([lo,hi])}));
  // At the zoom ceiling, adjacent device pixels must remain distinct even
  // though global Mercator float32 coordinates cannot represent their offsets.
  const nativeSize=512,nativeLevel=18,nativeN=2**nativeLevel;
  const fine=new Float32Array(nativeSize*nativeSize*2);
  for(let y=0;y<nativeSize;y++)for(let x=0;x<nativeSize;x++){const i=(y*nativeSize+x)*2;fine[i]=3*x;fine[i+1]=1;}
  const fineTexture=device.createTexture({size:[nativeSize,nativeSize],format:'rg32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC});device.queue.writeTexture({texture:fineTexture},fine,{bytesPerRow:nativeSize*8},[nativeSize,nativeSize]);
  const fineKey='18/131072/131072',fineView={x:.5+.5/nativeN,y:.5+.5/nativeN};
  const fineCamera=sphereCamera(fineView,32,32,1,Math.log2(nativeSize*nativeN/(2*Math.PI*.46*32)));
  const fineOptions={sphere:fineCamera,palette:0,min:710,max:820,tiles:[{key:fineKey,x:131072,y:131072,z:18}],cache:new Map([[fineKey,{state:'ready',texture:fineTexture,size:nativeSize}]])};
  const finePixels=await pixels(0,710,fineOptions);
  const distinctNativePixels=new Set(Array.from({length:30},(_,x)=>finePixels[16*256+(x+1)*4])).size;
  if(distinctNativePixels<28)throw Error(`Native globe sampling collapsed adjacent pixels into bands: ${distinctNativePixels} distinct samples: ${Array.from({length:32},(_,x)=>finePixels[16*256+x*4])}`);
  const fineShaded=await pixels(1,710,fineOptions);
  canvas.width=canvas.height=48;
  const resizedPixels=await pixels(1,710,{...fineOptions,sphere:{...fineCamera,width:48,height:48}});
  let resizeDifference=0;
  for(let y=8;y<24;y++)for(let x=8;x<24;x++)for(let c=0;c<3;c++)resizeDifference=Math.max(resizeDifference,Math.abs(fineShaded[y*256+x*4+c]-resizedPixels[(y+8)*256+(x+8)*4+c]));
  if(resizeDifference>1)throw Error(`Resizing changed edge shading at the same terrain coordinates: ${resizeDifference}`);
  canvas.width=canvas.height=32;
  const flatFine={...fineOptions,sphere:null,tiles:[{key:fineKey,left:-240,top:-240,size:512}]};
  const flatBefore=await pixels(1,710,flatFine);
  canvas.width=canvas.height=48;
  const flatAfter=await pixels(1,710,{...flatFine,tiles:[{key:fineKey,left:-232,top:-232,size:512}]});
  let flatResizeDifference=0;
  for(let y=8;y<24;y++)for(let x=8;x<24;x++)for(let c=0;c<3;c++)flatResizeDifference=Math.max(flatResizeDifference,Math.abs(flatBefore[y*256+x*4+c]-flatAfter[(y+8)*256+(x+8)*4+c]));
  if(flatResizeDifference>1)throw Error(`Flat resize changed edge shading: ${flatResizeDifference}`);
  canvas.width=canvas.height=32;
  return {distinctNativePixels,resizeDifference,flatResizeDifference,parentExposure,quadrantExposure,globeCenter,globeCorner,globeExposure,highlightChecks,shoreline,all,land,off:at(off,11),on:at(on,11),boundary:at(on,15),shifted:at(shifted,11),smooth:[at(off,9),at(off,10),at(off,11)],errors};
 });
 assert.deepEqual(result.parentExposure,[253.125,400],'flat parent fallback must crop the requested region correctly');
 assert.notDeepEqual(result.globeCenter,result.globeCorner,'sphere should render terrain only inside its disk');assert.deepEqual(result.globeExposure,[600,600]);assert.deepEqual(result.quadrantExposure,[100,400]);
 for(const check of result.highlightChecks){assert.deepEqual(check.end,check.base,'all palettes must reach zero at the same elevation bound');assert.deepEqual(check.narrow,check.base,'narrow highlights exclude distant elevations');assert.notDeepEqual(check.peak,check.base,'center elevation is highlighted');assert.notDeepEqual(check.broad,check.base,'increasing width includes more elevations');}
 assert.deepEqual(result.shoreline,[600,-1,610,-1,620,1,-15,-1]);
 assert.deepEqual(result.all,[-50,1500]);assert.deepEqual(result.land,[-50,900]); // ocean column is excluded, negative land survives.
 assert.notEqual(result.off,result.shifted,'slider range must immediately recolor the existing height texture');
 assert.notEqual(result.smooth[0],result.smooth[1],'overzoomed heights interpolate between source texels');
 assert.ok(result.on>result.off,'overzoomed source-aware footprint highlights the terrain slope away from pixel boundaries');assert.deepEqual(result.errors,[]);assert.deepEqual(errors,[]);
 console.log('PASS shared elevation highlight bands in all palettes');
 console.log('PASS GPU reduction, classified ocean masking, negative land, immediate uniform recoloring, source-aware Sobel and interpolated overzoom, and zero-edge path',result);
 await page.waitForFunction(()=>document.querySelector('#coverage').textContent!=='—',null,{timeout:30000});
 assert.equal(await page.locator('#palette').inputValue(),'1');assert.equal(await page.locator('#palette option[value="0"]').textContent(),'Grayscale');
 assert.equal(await page.locator('#water').isChecked(),false);assert.equal(await page.locator('#edges').isChecked(),true);assert.equal(await page.locator('#edges-number').count(),0);assert.equal(await page.locator('input[type=range]#edges').count(),0);assert.equal(await page.locator('aside > section').count(),2);assert.equal(await page.locator('header #projection').count(),1);
 await page.locator('#min-lock').click();await page.locator('#max-lock').click();assert.equal(await page.locator('#min-lock').getAttribute('aria-pressed'),'true');assert.ok(Number(await page.locator('#min').evaluate(e=>getComputedStyle(e).opacity))<1);assert.equal(await page.locator('#min').isDisabled(),false);
 async function limit(id,value){await page.locator('#'+id).fill(String(value));await page.locator('#'+id).dispatchEvent('input');await page.waitForTimeout(50);}
 await limit('min',0);await limit('max',8000);await page.locator('#legend').hover({position:{x:124,y:12}});assert.equal(await page.locator('#legend-hover').isVisible(),true);const legendBox=await page.locator('#legend').boundingBox(),hoverBox=await page.locator('#legend-hover-value').boundingBox();assert.ok(Math.abs(hoverBox.x+hoverBox.width/2-(legendBox.x+124))<1);
 await page.locator('#legend').click({position:{x:124,y:12}});await page.mouse.move(1000,20);await page.waitForTimeout(50);
 const pinned=Number(await page.locator('#highlight-value').getAttribute('data-elevation')),band=Number(await page.locator('#highlight-width').inputValue());assert.equal(band,1000);
 await page.locator('#palette-flip').click();assert.equal(await page.locator('#palette-flip').getAttribute('aria-pressed'),'true');assert.equal(Number(await page.locator('#highlight-value').getAttribute('data-elevation')),pinned);await page.locator('#palette-flip').click();assert.equal(await page.locator('#palette-flip').getAttribute('aria-pressed'),'false');

 assert.equal(await page.title(),'Elevation Atlas');assert.equal(await page.locator('h1').innerText(),'Elevation Atlas');
 await page.locator('#highlight-width-lock').click();assert.equal(await page.locator('#highlight-width-lock').getAttribute('aria-pressed'),'true');
 await limit('max',100);assert.equal(Number(await page.locator('#highlight-width').inputValue()),band);assert.equal(Number(await page.locator('#highlight-width-number').inputValue()),band);
 await limit('highlight-width',750);await limit('max',9000);assert.equal(Number(await page.locator('#highlight-width').inputValue()),750);
 await limit('highlight-width',band);await limit('max',8000);await page.locator('#highlight-width-lock').click();
 assert.equal(await page.locator('#highlight-width-lock').getAttribute('aria-pressed'),'false');
 await limit('max',4000);assert.equal(Number(await page.locator('#highlight-value').getAttribute('data-elevation')),pinned);assert.equal(Number(await page.locator('#highlight-width').inputValue()),band/2);
 await limit('max',100);assert.equal(Number(await page.locator('#highlight-value').getAttribute('data-elevation')),pinned);assert.match(await page.locator('#highlight-band').textContent(),/outside scale/);
 assert.equal(Number(await page.locator('#highlight-width').inputValue()),12.5);
 await page.locator('#highlight-width').fill('25');await page.locator('#highlight-width').dispatchEvent('input');assert.equal(await page.locator('#highlight-width-number').inputValue(),'25');assert.equal(Number(await page.locator('#highlight-value').getAttribute('data-elevation')),pinned);
 await limit('max',200);assert.equal(Number(await page.locator('#highlight-width').inputValue()),50);assert.equal(Number(await page.locator('#highlight-value').getAttribute('data-elevation')),pinned);
 assert.match(await page.locator('label.toggle').filter({has:page.locator('#water')}).textContent(),/Water/);
 await page.selectOption('#palette','0');await page.waitForTimeout(50);assert.equal(Number(await page.locator('#highlight-value').getAttribute('data-elevation')),pinned);assert.equal(await page.locator('#highlight-elevation-number').isDisabled(),false);
 await page.locator('#highlight-elevation-number').fill('1234');await page.locator('#highlight-elevation-number').dispatchEvent('input');await page.waitForTimeout(50);assert.equal(Number(await page.locator('#highlight-value').getAttribute('data-elevation')),1234);
 await page.locator('#min-number').fill('-750');await page.locator('#min-number').dispatchEvent('input');assert.equal(await page.locator('#min').inputValue(),'-750');
 await page.locator('#max-number').fill('3200');await page.locator('#max-number').dispatchEvent('input');assert.equal(await page.locator('#max').inputValue(),'3200');
 await page.locator('#edges').uncheck();await page.waitForTimeout(600);await page.locator('#edges').check();await page.waitForTimeout(600);
 await page.getByRole('button',{name:'Increase minimum elevation',exact:true}).click();assert.equal(await page.locator('#min').inputValue(),'-749');await page.getByRole('button',{name:'Decrease minimum elevation',exact:true}).click();assert.equal(await page.locator('#min').inputValue(),'-750');
 const accent=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent'));await page.selectOption('#palette','2');assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent')),accent);
 await page.locator('#highlight').uncheck();assert.equal(await page.locator('#highlight-elevation').isDisabled(),true);assert.equal(await page.locator('#highlight-width-number').isDisabled(),true);assert.equal(await page.locator('#edges').isDisabled(),false);
 await page.locator('#projection').check();await page.waitForTimeout(1000);assert.match(await page.locator('#level').textContent(),/sphere/);const globePixels=await page.locator('#pixels').textContent();console.log('Sphere UI at full DPR',globePixels);
 await page.screenshot({path:'/tmp/elevation-sphere-ui.png'});await page.locator('#projection').uncheck();await page.waitForTimeout(50);
 for(const id of ['min-lock','max-lock','fullscreen']){const box=await page.locator('#'+id).boundingBox(),svg=await page.locator('#'+id+' svg:visible').first().boundingBox();assert.ok(Math.abs(box.x+box.width/2-svg.x-svg.width/2)<.1);assert.ok(Math.abs(box.y+box.height/2-svg.y-svg.height/2)<.1);}
 const order=await page.evaluate(()=>['water','min','max','palette'].map(id=>document.getElementById(id).getBoundingClientRect().y));assert.ok(order.every((y,i)=>i===0||y>order[i-1]));
 await page.locator('#map').focus();const keyStart=await page.evaluate(()=>location.hash);await page.keyboard.down('ArrowRight');await page.waitForFunction(hash=>location.hash!==hash,keyStart,{timeout:5000});const keyMiddle=await page.evaluate(()=>location.hash);await page.waitForFunction(hash=>location.hash!==hash,keyMiddle,{timeout:5000});const keyEnd=await page.evaluate(()=>location.hash);await page.keyboard.up('ArrowRight');assert.notEqual(keyMiddle,keyStart);assert.notEqual(keyEnd,keyMiddle);await page.waitForTimeout(700);
 const wasdStart=await page.evaluate(()=>location.hash);await page.keyboard.down('w');await page.waitForFunction(hash=>location.hash!==hash,wasdStart,{timeout:5000});await page.keyboard.up('w');assert.notEqual(await page.evaluate(()=>location.hash),wasdStart);await page.waitForTimeout(700);
 const zoomStart=Number((await page.evaluate(()=>location.hash)).slice(1).split('/')[0]);await page.keyboard.down('Equal');await page.waitForFunction(zoom=>Number(location.hash.slice(1).split('/')[0])>zoom,zoomStart,{timeout:5000});await page.keyboard.up('Equal');await page.waitForTimeout(700);assert.ok(Number((await page.evaluate(()=>location.hash)).slice(1).split('/')[0])>zoomStart);
 await page.locator('#min-number').focus();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const typingHash=await page.evaluate(()=>location.hash);await page.keyboard.down('w');await page.waitForTimeout(120);await page.keyboard.up('w');assert.equal(await page.evaluate(()=>location.hash),typingHash);
 const mapBox=await page.locator('#map').boundingBox(),wheelX=Math.round(mapBox.x+mapBox.width*.3),wheelY=Math.round(mapBox.y+mapBox.height*.45),dx=wheelX-mapBox.x-mapBox.width/2,dy=wheelY-mapBox.y-mapBox.height/2;await page.mouse.move(wheelX,wheelY);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const beforeWheel=(await page.evaluate(()=>location.hash)).slice(1).split('/').map(Number);await page.mouse.wheel(0,-120);await page.waitForFunction(zoom=>Number(location.hash.slice(1).split('/')[0])>zoom,beforeWheel[0],{timeout:5000});const afterWheel=(await page.evaluate(()=>location.hash)).slice(1).split('/').map(Number);assert.ok(Math.abs(beforeWheel[1]+dx/(256*2**beforeWheel[0])-afterWheel[1]-dx/(256*2**afterWheel[0]))<1e-5);assert.ok(Math.abs(beforeWheel[2]+dy/(256*2**beforeWheel[0])-afterWheel[2]-dy/(256*2**afterWheel[0]))<1e-5);
 console.log('PASS continuous arrow/WASD/zoom controls, input isolation, anchored flat zoom, hover labels and centered icons');
const panelBox=await page.locator('#map-panel').boundingBox(),canvasBox=await page.locator('#map').boundingBox();assert.deepEqual(canvasBox,panelBox);assert.equal(await page.locator('#map-panel .stage #message').count(),1);assert.equal(await page.locator('aside #position').count(),1);assert.equal(await page.locator('aside #message').count(),0);
 await limit('min',-11000);await limit('max',8850);await page.locator('#min-lock').click();await page.locator('#max-lock').click();await page.waitForFunction(()=>parseInt(document.querySelector('#coverage').textContent)>0,null,{timeout:30000});await page.locator('#map').focus();await page.keyboard.down('d');await page.waitForFunction(()=>Math.abs(Number(document.querySelector('#min').value)+11000)>100||Math.abs(Number(document.querySelector('#max').value)-8850)>100,null,{timeout:5000});console.log('PASS exposure changes while a pan key remains held');await page.keyboard.up('d');await page.waitForTimeout(650);
 const boundsBox=await page.locator('#map').boundingBox();for(const direction of [1,-1]){await page.mouse.move(boundsBox.x+boundsBox.width/2,boundsBox.y+boundsBox.height*(direction===1?.2:.8));await page.mouse.down();await page.mouse.move(boundsBox.x+boundsBox.width/2,boundsBox.y+boundsBox.height*(direction===1?.8:.2),{steps:6});await page.mouse.up();await page.waitForTimeout(100);const state=(await page.evaluate(()=>location.hash)).slice(1).split('/').map(Number),half=boundsBox.height/(2*256*2**state[0]);assert.ok(state[2]-half>=-1e-5);assert.ok(state[2]+half<=1+1e-5);}console.log('PASS north/south viewport bounds');
 await page.locator('#fullscreen').click();await page.waitForFunction(()=>document.querySelector('#fullscreen').getAttribute('aria-pressed')==='true');assert.ok(await page.locator('#map-panel').evaluate(e=>e.getBoundingClientRect().width>=innerWidth-2));assert.equal(await page.locator('.map-heading').isVisible(),false);assert.equal(await page.locator('.map-footer').isVisible(),false);await page.locator('#message').evaluate(e=>e.textContent='Loading native-resolution terrain…');assert.equal(await page.locator('#message').isVisible(),true);assert.equal(await page.locator('#fullscreen').isVisible(),false);const fullCanvas=await page.locator('#map').boundingBox(),screenSize=await page.evaluate(()=>({w:innerWidth,h:innerHeight}));assert.equal(fullCanvas.x,0);assert.equal(fullCanvas.y,0);assert.equal(fullCanvas.width,screenSize.w);assert.equal(fullCanvas.height,screenSize.h);assert.equal(await page.locator('#fullscreen-exit').isVisible(),true);await page.locator('#fullscreen-exit').click();await page.waitForFunction(()=>document.querySelector('#fullscreen').getAttribute('aria-pressed')==='false');assert.equal(await page.locator('#fullscreen-exit').isVisible(),false);await page.locator('#fullscreen').click();await page.waitForFunction(()=>document.querySelector('#fullscreen').getAttribute('aria-pressed')==='true');await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('#fullscreen').getAttribute('aria-pressed')==='false');await page.screenshot({path:'/tmp/elevation-compact-ui.png'});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);console.log('PASS Water off by default, dimmed locks, edge-to-edge canvas, header view controls, half-second tracking, animated edge toggle, reordered controls, sine transitions, icon locks, inline numeric steppers, canvas-only Escape fullscreen, map-toolbar toggle, defaults, compact fixed-color UI, disabled highlight controls, sphere toggle, Thermal default, Grayscale label, elevation label, fixed elevation and proportional width across exposure changes, adjustable width, and mobile overflow');
 await page.close();
 }
 // Deterministic recovery fixture: a hung worker request, then a transient failure,
 // then success. The view stays still throughout; this exercises real timeout/backoff.
 const recovery=await browser.newPage({viewport:{width:800,height:600}});
 await recovery.route(/https:\/\/tiles\.(mapterhorn\.com|openwaters\.io)\/.*json$/,route=>route.fulfill({json:{tiles:['https://fixture.invalid/{z}/{x}/{y}'],tileSize:4,maxzoom:0,schema:1}}));
 await recovery.addInitScript(()=>{
  window.tileAttempts=0;window.tileCancels=0;window.tileAttemptTimes=[];
  window.Worker=class{
   postMessage(message){
    if(message.cancel){window.tileCancels++;return;}
    window.tileAttemptTimes.push(performance.now());const attempt=++window.tileAttempts;if(attempt===1)return;
    setTimeout(()=>{
     if(attempt===2){this.onmessage({data:{id:message.id,error:'Simulated transient failure'}});return;}
     const values=new Float32Array(32);for(let i=0;i<32;i+=2){values[i]=600;values[i+1]=1;}
     this.onmessage({data:{id:message.id,size:4,values,overzoomed:false}});
    },10);
   }
  };
 });
 await recovery.goto('http://127.0.0.1:8095');
 await recovery.waitForFunction(()=>window.tileAttempts>=3&&/^([1-9]\d*) \/ \1$/.test(document.querySelector('#coverage').textContent),null,{timeout:30000});
 assert.ok(await recovery.evaluate(()=>window.tileCancels>=1));
 const attempts=await recovery.evaluate(()=>window.tileAttempts);assert.equal(attempts,3);const retryDelay=await recovery.evaluate(()=>window.tileAttemptTimes[1]-window.tileAttemptTimes[0]);assert.ok(retryDelay>=950&&retryDelay<1800,`First stalled request should retry after one second, observed ${retryDelay} ms`);
 console.log('PASS stalled tile timeout, cancellation, automatic retry after failure, and recovery without navigation');
 const probeBox=await recovery.locator('#map').boundingBox(),probeX=Math.round(probeBox.x+probeBox.width/2),probeY=Math.round(probeBox.y+probeBox.height/2);
 await recovery.mouse.move(probeX,probeY);
 await recovery.waitForFunction(()=>document.querySelector('#cursor-elevation').textContent==='600 m');
 const hoverLocation=await recovery.locator('#position').textContent();
 await recovery.mouse.move(probeX+50,probeY+30);await recovery.waitForFunction(old=>document.querySelector('#position').textContent!==old,hoverLocation);
 const headingHeight=await recovery.locator('#probe-unpin').evaluate(e=>e.parentElement.getBoundingClientRect().height);await recovery.mouse.move(probeX,probeY);await recovery.mouse.down();await recovery.waitForTimeout(620);await recovery.mouse.up();await recovery.waitForFunction(()=>!document.querySelector('#probe-unpin').hidden);
 const pinnedLocation=await recovery.locator('#pinned-position').textContent();assert.equal(await recovery.locator('#pinned-elevation').textContent(),'600 m');assert.equal(await recovery.locator('#probe-unpin').evaluate(e=>e.parentElement.getBoundingClientRect().height),headingHeight);assert.equal(await recovery.locator('#position').evaluate(e=>getComputedStyle(e).fontSize),await recovery.locator('#cursor-elevation').evaluate(e=>getComputedStyle(e).fontSize));
 await recovery.mouse.move(probeX+80,probeY);await recovery.waitForFunction(old=>document.querySelector('#position').textContent!==old,pinnedLocation);assert.equal(await recovery.locator('#cursor-elevation').textContent(),'600 m');await recovery.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await recovery.locator('#pinned-position').textContent(),pinnedLocation);
 const beforeProbePan=await recovery.evaluate(()=>location.hash);await recovery.locator('#map').focus();await recovery.keyboard.down('d');await recovery.waitForFunction(old=>location.hash!==old,beforeProbePan);await recovery.keyboard.up('d');
 assert.equal(await recovery.locator('#pinned-position').textContent(),pinnedLocation);
 await recovery.locator('#probe-unpin').click();await recovery.waitForFunction(()=>document.querySelector('#pinned-position').textContent==='—');await recovery.mouse.move(probeX,probeY);
 await recovery.waitForFunction(old=>document.querySelector('#position').textContent!==old,pinnedLocation);
 await recovery.locator('#projection').check();await recovery.mouse.move(probeX,probeY);
 await recovery.waitForFunction(()=>document.querySelector('#cursor-elevation').textContent==='600 m');
 await recovery.mouse.move(probeBox.x+3,probeBox.y+3);await recovery.waitForFunction(()=>document.querySelector('#position').textContent==='—');
 console.log('PASS native elevation hover, geographic press-and-hold pin across pan, unpin, and sphere hover/background');
 await recovery.locator('#projection').uncheck();

 // Use realistic global metadata with the deterministic worker to exercise caps.
 await recovery.route(/https:\/\/tiles\.(mapterhorn\.com|openwaters\.io)\/.*json$/,route=>route.fulfill({json:{tiles:['https://fixture.invalid/{z}/{x}/{y}'],tileSize:512,maxzoom:18,schema:1}}));
 await recovery.goto('http://127.0.0.1:8095/#99/.5/.42');await recovery.reload();
 await recovery.waitForFunction(()=>document.querySelector('#level').textContent!=='—');
 assert.equal(Number((await recovery.evaluate(()=>location.hash)).slice(1).split('/')[0]),19);
 await recovery.locator('#map').dispatchEvent('wheel',{deltaY:-10000,bubbles:true});
 await recovery.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(Number((await recovery.evaluate(()=>location.hash)).slice(1).split('/')[0]),19);
 await recovery.locator('#projection').check();
 await recovery.locator('#map').dispatchEvent('wheel',{deltaY:-10000,bubbles:true});
 await recovery.waitForFunction(()=>document.querySelector('#scale').textContent==='0.30 m / device px at center');
 await recovery.setViewportSize({width:1100,height:700});
 await recovery.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await recovery.locator('#scale').textContent(),'0.30 m / device px at center');
 console.log('PASS flat and sphere native-resolution zoom ceilings, deep-link clamp, and sphere resize');

}finally{await browser?.close();server.kill();}
