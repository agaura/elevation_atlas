// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tests/terrain-gradient-webgpu.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8106'},stdio:['ignore','pipe','inherit']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});
 const page=await browser.newPage(),pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
 await page.route('**/gradient-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Source gradient fixture</title>'}));
 await page.goto('http://127.0.0.1:8106/gradient-fixture');
 const result=await page.evaluate(async()=>{
  const {createRenderer}=await import('/gpu.js'),{uploadTerrainTexture}=await import('/terrain-gpu.js'),{sphereCamera}=await import('/sphere.js');
  const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice(),errors=[];
  device.addEventListener('uncapturederror',event=>errors.push(event.error.message));
  const createTexture=device.createTexture.bind(device);let screen;
  device.createTexture=descriptor=>{
   if(descriptor.format==='rg32float'&&(descriptor.usage&GPUTextureUsage.RENDER_ATTACHMENT)){
    screen=createTexture({...descriptor,usage:descriptor.usage|GPUTextureUsage.COPY_SRC});return screen;
   }
   return createTexture(descriptor);
  };
  const canvas=document.createElement('canvas'),legend=document.createElement('canvas');canvas.width=canvas.height=64;legend.width=64;legend.height=2;
  const context=canvas.getContext('webgpu'),legendContext=legend.getContext('webgpu');
  for(const ctx of [context,legendContext])ctx.configure({device,format:'rgba16float',colorSpace:'display-p3',toneMapping:{mode:'extended'},alphaMode:'opaque'});
  const renderer=await createRenderer(device,'rgba16float',context,legendContext),size=128,entries=[];
  function fixture(height,kind=()=>1){
   const values=new Float32Array(size*size*2);
   for(let y=0;y<size;y++)for(let x=0;x<size;x++){const index=(y*size+x)*2;values[index]=height(x,y);values[index+1]=kind(x,y);}
   const entry={size,values,state:'ready'};uploadTerrainTexture(device,entry);entries.push(entry);return entry;
  }
  const periodic=fixture((x,y)=>600+20*Math.sin(x*1.1)+13*Math.cos(y*.8)+7*Math.sin(x*.31+y*.47));
  const planar=fixture((x,y)=>600+7*x+3*y);
  const coast=fixture(x=>x<64?600:9000,x=>x<64?1:-1),nodata=fixture(x=>x<64?600:1e30);
  const base={dpr:1,canvas,legend,min:0,max:2000,palette:1,hdr:2,p3:1,emphasis:false,edges:1,noOcean:false,reduce:false};
  async function read(entry,{left=0,pixels=128,dpr=1,sphere=null,preview=false,edges=1,invalidate=true}={}){
   const tile={key:'0/0/0',z:0,x:0,y:0,left:left/dpr,top:left/dpr,size:pixels/dpr};
   if(preview){tile.sourceKey='0/0/0';tile.uv=[0,0,1];}
   if(invalidate)renderer.invalidate();
   renderer.render({...base,dpr,edges,sphere,tiles:[tile],cache:new Map([['0/0/0',entry]])});
   const buffer=device.createBuffer({size:64*512,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=device.createCommandEncoder();
   encoder.copyTextureToBuffer({texture:screen},{buffer,bytesPerRow:512},[64,64]);device.queue.submit([encoder.finish()]);
   await buffer.mapAsync(GPUMapMode.READ);const data=new Float32Array(buffer.getMappedRange()).slice();buffer.unmap();buffer.destroy();return data;
  }
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  const height=(entry,x,y)=>entry.values[(clamp(y,0,size-1)*size+clamp(x,0,size-1))*2];
  function sobel(entry,x,y){
   x=clamp(x,0,size-1);y=clamp(y,0,size-1);
   const h=(dx,dy)=>height(entry,x+dx,y+dy);
   const gx=(-h(-1,-1)-2*h(-1,0)-h(-1,1)+h(1,-1)+2*h(1,0)+h(1,1))*2/Math.max(1,clamp(x+1,0,size-1)-clamp(x-1,0,size-1));
   const gy=(-h(-1,-1)-2*h(0,-1)-h(1,-1)+h(-1,1)+2*h(0,1)+h(1,1))*2/Math.max(1,clamp(y+1,0,size-1)-clamp(y-1,0,size-1));
   return Math.hypot(gx,gy);
  }
  function bilerp(sample,x,y){
   x=clamp(x,0,size-1);y=clamp(y,0,size-1);const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
   return (sample(ix,iy)*(1-fx)+sample(ix+1,iy)*fx)*(1-fy)+(sample(ix,iy+1)*(1-fx)+sample(ix+1,iy+1)*fx)*fy;
  }
  let worstCase=null,worstReferenceError=0,oldSquared=0,newSquared=0,samples=0;
  // Include the reported zoom's almost-one-device-pixel source spacing.
  for(const ratio of [2**(5.984-6),.75,1,2.25])for(const phase of [0,.2,.5,.8])for(const dpr of [1,2,3]){
   const pixels=size*ratio,left=-12+phase,data=await read(periodic,{pixels,left,dpr});
   const sourceXY=(x,y)=>[(x+.5-left)/pixels*size-.5,(y+.5-left)/pixels*size-.5];
   const screenHeight=(x,y)=>{const [u,v]=sourceXY(x,y);return bilerp((a,b)=>height(periodic,a,b),u,v);};
   for(let y=5;y<59;y+=3)for(let x=5;x<59;x+=3){
    const [u,v]=sourceXY(x,y),expected=bilerp((a,b)=>sobel(periodic,a,b),u,v),actual=data[(y*64+x)*2+1];
    const error=Math.abs(actual-expected);if(error>worstReferenceError)worstCase={ratio,phase,dpr,x,y,u,v,actual,expected};worstReferenceError=Math.max(worstReferenceError,error);newSquared+=error*error;
    if(ratio<1){
     const h=(dx,dy)=>screenHeight(x+dx,y+dy);
     const old=Math.hypot(-h(-1,-1)-2*h(-1,0)-h(-1,1)+h(1,-1)+2*h(1,0)+h(1,1),-h(-1,-1)-2*h(0,-1)-h(1,-1)+h(-1,1)+2*h(0,1)+h(1,1));
     oldSquared+=(old-expected)**2;
    }
    samples++;
   }
  }
  if(worstReferenceError>.02)throw Error('Source-space gradient mismatch: '+JSON.stringify(worstCase));
  if(oldSquared<1||newSquared>=oldSquared*.001)throw Error('Expected a substantial reduction in sampling-dependent gradient error');
  const expectedSlope=8*Math.hypot(7,3);
  let worstPlanarError=0;
  for(const left of [0,.2,.5,.8]){
   const data=await read(planar,{left,pixels:127});
   for(let y=0;y<64;y++)for(let x=0;x<64;x++)if(data[(y*64+x)*2]>=-40000)worstPlanarError=Math.max(worstPlanarError,Math.abs(data[(y*64+x)*2+1]-expectedSlope));
  }
  for(const center of [[.5,.5],[.501,.5],[.5,.501]]){
   const sphere=sphereCamera({x:center[0],y:center[1]},64,64,1,0),data=await read(planar,{sphere});
   for(let i=0;i<data.length;i+=2)if(data[i]>=-40000&&data[i]<=40000)worstPlanarError=Math.max(worstPlanarError,Math.abs(data[i+1]-expectedSlope));
  }
  if(worstPlanarError>.02)throw Error('Planar gradients must remain stable through subpixel pans, boundaries and globe projection: '+worstPlanarError);
  for(const entry of [coast,nodata]){
   const data=await read(entry,{pixels:128,left:-32.5});
   for(let y=4;y<60;y++)for(let x=4;x<60;x++)if(data[(y*64+x)*2]>=-40000&&data[(y*64+x)*2]<=40000&&Math.abs(data[(y*64+x)*2+1])>.01)throw Error('Water/nodata generated a false edge');
  }
  const preview=await read(planar,{preview:true});if(preview[33]!==-1)throw Error('Parent preview edges must be suppressed');
  const disabled=await read(planar,{edges:0});if(disabled[33]!==-1)throw Error('Zero-strength height pass must skip gradients');
  const enabled=await read(planar,{edges:1,invalidate:false});if(Math.abs(enabled[33]-expectedSlope)>.02)throw Error('Enabling edges must refresh a cached height pass');
  await device.queue.onSubmittedWorkDone();for(const entry of entries)entry.texture.destroy();
  return {worstReferenceError,worstPlanarError,sourceRmsError:Math.sqrt(newSquared/samples),oldScreenRmsError:Math.sqrt(oldSquared/samples),errors};
 });
 assert.deepEqual(result.errors,[]);assert.deepEqual(pageErrors,[]);
 console.log('PASS source-gradient GPU reference, fractional pans/DPR, tile boundaries, globe stability, class masks, previews and edge toggling',result);
}finally{await browser?.close();server.kill();}
