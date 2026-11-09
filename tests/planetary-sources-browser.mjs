// Live read-only source probe: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/planetary-sources-browser.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'8142'},stdio:['ignore','pipe','inherit']});
await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 await page.route('**/planetary-fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto('http://127.0.0.1:8142/planetary-fixture');
 const result=await page.evaluate(async()=>{
  const {fromUrl}=await import('/vendor/geotiff/geotiff.js');
  const terrain=[];
  for(const [body,lon,lat] of [['mars',-133.8,18.65],['moon',-11.36,-43.31]]){
   const base=`https://marshub.s3.amazonaws.com/${body}_v14/`;
   const manifest=await fetch(base+'layer.json',{signal:AbortSignal.timeout(20000)}).then(r=>{if(!r.ok)throw Error('Manifest '+r.status);return r.json();});
   const meshes=[];
   for(const z of [0,8]){
    const x=z===0?0:Math.floor((lon+180)/360*2**(z+1)),y=z===0?0:Math.floor((lat+90)/180*2**z);
    const response=await fetch(`${base}${z}/${x}/${y}.terrain?v=${manifest.version}`,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Terrain '+response.status);
    const bytes=await response.arrayBuffer(),view=new DataView(bytes);
    const min=view.getFloat32(24,true),max=view.getFloat32(28,true),vertices=view.getUint32(88,true);
    if(!(vertices>=3&&vertices<1e7&&min>=-30000&&max<=40000&&min<=max&&bytes.byteLength>=92+vertices*6))throw Error('Invalid terrain header');
    const heights=[];let decoded=0;
    for(let i=0;i<vertices;i++){
     const encoded=view.getUint16(92+vertices*4+i*2,true);decoded+=(encoded>>>1)^-(encoded&1);
     if(decoded<0||decoded>32767)throw Error('Invalid quantized height');
     if(i<5)heights.push(min+(max-min)*decoded/32767);
    }
    meshes.push({z,x,y,bytes:bytes.byteLength,vertices,min,max,heightQuantizationMetres:(max-min)/32767,heights});
   }
   terrain.push({body,format:manifest.format,projection:manifest.projection,scheme:manifest.scheme,advertisedMaxZoom:manifest.maxzoom,meshes});
  }
  const rasters=[];
  for(const [body,collection,asset] of [['mars','mro_ctx_controlled_usgs_dtms','geoid_adjusted_dem'],['moon','kaguya_terrain_camera_usgs_dtms_v2_equi','dtm']]){
   const collectionUrl=`https://stac.astrogeology.usgs.gov/api/collections/${collection}/items?limit=1`;
   const response=await fetch(collectionUrl,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Catalog '+response.status);
   const item=(await response.json()).features[0],url=item.assets[asset].href;
   const started=performance.now();let requests=0,bytes=0;
   const nativeFetch=globalThis.fetch;
   const observedFetch=async(input,init)=>{const r=await nativeFetch(input,{...init,signal:AbortSignal.timeout(30000)});requests++;bytes+=Number(r.headers.get('content-length')??0);if(r.status!==206)throw Error('DEM server must honor ranges: '+r.status);return r;};
   globalThis.fetch=observedFetch;
   const tiff=await fromUrl(url,{allowFullFile:false});
   const image=await tiff.getImage(),width=image.getWidth(),height=image.getHeight(),nodata=image.getGDALNoData(),x=Math.floor(width/2),y=Math.floor(height/2);
   const values=await image.readRasters({window:[x,y,x+16,y+16],samples:[0],interleave:true});
   const valid=Array.from(values).filter(v=>Number.isFinite(v)&&v!==nodata);
   if(!valid.length)throw Error('No decoded elevations in DEM patch');
   const overviews=await tiff.getImageCount();
   globalThis.fetch=nativeFetch;
   if(!requests||!bytes)throw Error('Missing byte-range observations');
   rasters.push({body,item:item.id,url,width,height,overviews,resolution:image.getResolution(),geoKeys:image.getGeoKeys(),nodata,min:Math.min(...valid),max:Math.max(...valid),milliseconds:Math.round(performance.now()-started),requests,bytes});
  }
  return {terrain,rasters};
 });
 assert.equal(result.terrain.length,2);assert.equal(result.rasters.length,2);console.log(JSON.stringify(result,null,2));
}finally{await browser?.close();server.kill();}
