import {getResource,putResource,resourceLifetime} from './resource-cache.js';
import {politeFetch,setBackgroundPaused} from './request-policy.js';
import {gebcoSampling} from './gebco.js';
import {decode,merge,wrap} from './terrain.js';
const controllers=new Map();
async function imageData(url,signal,retry){
 const key='terrain-image-v1:'+url;
 let cached=await getResource(key),bytes=cached?.data;
 signal.throwIfAborted();
 if(!bytes){
  const response=await politeFetch(url,{signal});
  if(!response.ok)throw Object.assign(Error(`Tile HTTP ${response.status}`),{status:response.status});
  bytes=await response.arrayBuffer();
  void putResource(key,{data:bytes},bytes.byteLength,resourceLifetime(response.headers));
 }
 signal.throwIfAborted();
 const bitmap=await createImageBitmap(new Blob([bytes]),{colorSpaceConversion:'none',premultiplyAlpha:'none'});
 const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d',{willReadFrequently:true});
 ctx.drawImage(bitmap,0,0);bitmap.close();return {size:canvas.width,data:ctx.getImageData(0,0,canvas.width,canvas.height).data};
}
async function sourceTile(source,t,signal,retry){for(let z=t.z;z>=0;z--){const factor=2**(t.z-z),x=Math.floor(t.x/factor),y=Math.floor(t.y/factor),url=source.tiles[0].replace('{z}',z).replace('{x}',wrap(x,2**z)).replace('{y}',y);try{return {...await imageData(url,signal,retry),factor,offsetX:wrap(t.x,factor),offsetY:wrap(t.y,factor)};}catch(error){if(error.status!==404||z===0)throw error;}}}
async function oceanTile(metadata,t,controller,retry,id,oceanSource){
 const size=Math.max(metadata.land.tileSize||512,metadata.sea.tileSize||512);
 if(oceanSource!=='gebco'||!gebcoSampling(t,size).useGebco)return sourceTile(metadata.sea,t,controller.signal,retry);
 // A GeoTIFF tile comprises several independently timed shared range reads.
 // Do not restart the whole job using the single-WebP one-second deadline.
 const progress=()=>self.postMessage({id,progress:true,timeout:10000});
 progress();
 const {gebcoTile}=await import('./gebco-reader.js');
 return gebcoTile(t,size,controller.signal,progress);
}
self.onmessage=async({data})=>{if(data.pauseBackground!==undefined){setBackgroundPaused(data.pauseBackground);return;}if(data.cancel){controllers.get(data.id)?.abort();return;}const {id,t,metadata,retry,oceanSource='seascape'}=data,controller=new AbortController();controllers.set(id,controller);try{const [land,sea]=await Promise.all([sourceTile(metadata.land,t,controller.signal,retry),oceanTile(metadata,t,controller,retry,id,oceanSource)]);const size=Math.max(land.size,sea.size),values=new Float32Array(size*size*2);function sample(src,x,y){
 if(src.values)return src.values[y*src.size+x];
 const read=(px,py)=>{const i=(Math.max(0,Math.min(src.size-1,py))*src.size+Math.max(0,Math.min(src.size-1,px)))*4;return src.data[i+3]===0?NaN:decode(src.data[i],src.data[i+1],src.data[i+2]);};
 const px=(src.offsetX+(x+.5)/size)*src.size/src.factor-.5,py=(src.offsetY+(y+.5)/size)*src.size/src.factor-.5;
 const nearest=read(Math.round(px),Math.round(py));if(src.factor===1)return nearest;
 const ix=Math.floor(px),iy=Math.floor(py),fx=px-ix,fy=py-iy;
 const a=read(ix,iy),b=read(ix+1,iy),c=read(ix,iy+1),d=read(ix+1,iy+1);
 if(![a,b,c,d].every(Number.isFinite)||(src===sea&&![a,b,c,d].every(v=>v<0)))return nearest;
 return (a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+d*fx)*fy;
 }for(let y=0;y<size;y++)for(let x=0;x<size;x++){const l=sample(land,x,y),s=sample(sea,x,y),i=(y*size+x)*2;values[i]=merge(l,s);// Keep water classification for the removal toggle, but use the elevation provider’s texel spacing.
values[i+1]=(Number.isFinite(s)&&(sea.values?s>=0:Math.round(s)>=2)?1:-1)*(s<0?sea.factor:land.factor);}if(!controller.signal.aborted){self.postMessage({id,size,values,oceanSource:sea.values?'gebco':'seascape',overzoomed:land.factor>1||sea.factor>1},[values.buffer]);}}catch(error){self.postMessage({id,error:error.message,status:error.status,retryAfterMs:error.retryAfterMs||0});}finally{controller.abort();controllers.delete(id);}};
