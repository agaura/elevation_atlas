import {visibleTiles,sourceZoom,wrap} from './terrain.js';
import {sphereTiles} from './sphere.js';
import {politeFetch,retryDelay} from './request-policy.js';
export const IMAGERY_SOURCES={
 earth:{name:'Esri World Imagery',credit:'Esri · Vantor · Earthstar Geographics · GIS User Community',url:'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false',maxzoom:23,tileSize:256,geographic:false,link:'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'},
 mars:{name:'Caltech CTX V01 mosaic',credit:'NASA/JPL-Caltech/MSSS · Caltech Murray Lab · Esri',url:'https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX1/MapServer/tile/{z}/{y}/{x}',maxzoom:12,tileSize:512,geographic:true,link:'https://murray-lab.caltech.edu/CTX/V01/SceneView/intro_c.html'},
 moon:{name:'JAXA / NASA Kaguya TC mosaic',credit:'JAXA/SELENE · NASA Trek',url:'https://trek.nasa.gov/tiles/Moon/EQ/Kaguya_TCortho_Mosaic_Global_4096ppd/1.0.0/default/default028mm/{z}/{y}/{x}.png',maxzoom:10,tileSize:256,geographic:true,link:'https://trek.nasa.gov/moon/'}
};
const lat=y=>Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI;
export function imageryTiles(body,{view,width,height,dpr,camera}){
 const source=IMAGERY_SOURCES[body],max=source.maxzoom+(source.geographic?1:0);
 const mercator=camera?sphereTiles(camera,max,source.tileSize):visibleTiles(view,width,height,sourceZoom(view.zoom,dpr,source.tileSize,max));
 const out=new Map();
 const add=(z,x,y)=>{const cols=2**z*(source.geographic?2:1),rows=2**z;if(y>=0&&y<rows){const tile={z,x:wrap(x,cols),y};tile.key=`${body}/${z}/${tile.x}/${y}`;out.set(tile.key,tile);}};
 for(const tile of mercator){
  if(!source.geographic)add(tile.z,tile.x,tile.y);
  else{
   const z=Math.max(0,tile.z-1),n=2**z,cols=n*2,x=Math.floor(wrap(tile.x,2**tile.z)/2**tile.z*cols),north=lat(tile.y/2**tile.z),south=lat((tile.y+1)/2**tile.z);
   for(let y=Math.floor((90-north)/180*n);y<=Math.min(n-1,Math.floor((90-south)/180*n));y++)add(z,x,y);
   if(tile.z===0)add(0,1,0);
  }
 }
 return [...out.values()];
}
export class Imagery{
 constructor(device,onChange,onStatus){this.device=device;this.onChange=onChange;this.onStatus=onStatus;this.entries=new Map();this.active=0;this.revision=0;this.bytes=0;this.enabled=false;this.queue=[];this.needed=new Set();this.budget=(matchMedia('(pointer: coarse)').matches?24:64)*1024*1024;}
 enable(value){this.enabled=value;if(!value){clearTimeout(this.timer);this.queue=[];for(const entry of this.entries.values())entry.abort?.abort();this.onStatus('');}this.onChange();}
 update(body,options){
  if(!this.enabled)return null;
  const source=IMAGERY_SOURCES[body],targets=imageryTiles(body,options),wanted=new Map();
  const add=t=>wanted.set(`${body}/${t.z}/${t.x}/${t.y}`,{...t,key:`${body}/${t.z}/${t.x}/${t.y}`});
  add({z:0,x:0,y:0});if(source.geographic)add({z:0,x:1,y:0});
  for(const tile of targets){let t={...tile};add(t);while(t.z>0){t={z:t.z-1,x:Math.floor(t.x/2),y:Math.floor(t.y/2)};add(t);}}
  this.needed=new Set(wanted.keys());
  for(const [key,entry] of this.entries)if(entry.abort&&!this.needed.has(key))entry.abort.abort();
  const now=performance.now();this.queue=[];
  for(const [key,tile] of wanted){let entry=this.entries.get(key);if(!entry){entry={tile,body,state:'idle',used:now};this.entries.set(key,entry);}entry.used=now;if(entry.state!=='ready'&&entry.state!=='loading'&&(entry.retryAt??0)<=now)this.queue.push(entry);}
  this.queue.sort((a,b)=>a.tile.z-b.tile.z);this.pump();
  let ready=0;for(const tile of targets)if(this.entries.get(tile.key)?.state==='ready')ready++;
  this.onStatus(ready<targets.length?'Loading satellite imagery…':'');
  const tiles=[...wanted.keys()].map(key=>this.entries.get(key)).filter(e=>e.state==='ready').sort((a,b)=>a.tile.z-b.tile.z);
  const retry=[...wanted.keys()].map(key=>this.entries.get(key)).filter(e=>e.state==='idle'&&(e.retryAt??0)>now).map(e=>e.retryAt);
  if(retry.length){clearTimeout(this.timer);this.timer=setTimeout(()=>this.onChange(),Math.max(50,Math.min(...retry)-now));}
  this.trim();return {tiles,source,revision:this.revision,...options};
 }
 pump(){
  if(!this.enabled||document.hidden)return;
  while(this.active<3&&this.queue.length){const entry=this.queue.shift();if(entry.state==='loading'||!this.needed.has(entry.tile.key))continue;this.load(entry);}
 }
 async load(entry){
  const {tile,body}=entry,source=IMAGERY_SOURCES[body],controller=new AbortController();entry.state='loading';entry.abort=controller;this.active++;
  const timeout=setTimeout(()=>controller.abort(),12000);let bitmap;
  try{
   const url=source.url.replace('{z}',tile.z).replace('{x}',tile.x).replace('{y}',tile.y),response=await politeFetch(url,{signal:controller.signal});
   if(!response.ok)throw Object.assign(Error(`Imagery HTTP ${response.status}`),{status:response.status});
   bitmap=await createImageBitmap(await response.blob(),{colorSpaceConversion:'none',premultiplyAlpha:'none'});controller.signal.throwIfAborted();
   if(bitmap.width>1024||bitmap.height>1024)throw Error('Unexpected imagery tile size');
   const texture=this.device.createTexture({size:[bitmap.width,bitmap.height],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
   this.device.queue.copyExternalImageToTexture({source:bitmap},{texture},[bitmap.width,bitmap.height]);
   Object.assign(entry,{texture,bytes:bitmap.width*bitmap.height*4,state:'ready'});this.bytes+=entry.bytes;this.revision++;
  }catch(error){entry.state='idle';entry.attempts=(entry.attempts??0)+1;entry.retryAt=performance.now()+(error.status===404?300000:retryDelay(error,entry.attempts,Math.random,1500));}
  finally{bitmap?.close();clearTimeout(timeout);delete entry.abort;this.active--;this.trim();this.pump();this.onChange();if(this.enabled){clearTimeout(this.timer);this.timer=setTimeout(()=>this.onChange(),1500);}}
 }
 trim(){
  for(const entry of [...this.entries.values()].sort((a,b)=>a.used-b.used)){
   if(this.bytes<=this.budget)break;if(this.needed.has(entry.tile.key)||entry.state!=='ready')continue;
   this.entries.delete(entry.tile.key);this.bytes-=entry.bytes;void this.device.queue.onSubmittedWorkDone().then(()=>entry.texture.destroy());
  }
  if(this.entries.size>768)for(const [key,entry] of this.entries){if(this.entries.size<=512)break;if(!this.needed.has(key)&&entry.state!=='ready'&&!entry.abort)this.entries.delete(key);}
 }
}
