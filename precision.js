const valid=h=>Number.isFinite(h)&&h>=-40000&&h<=40000;
export function quantizeTerrain(values,min,max,out=new Uint8Array(values.length)){
 const scale=255/Math.max(max-min,1/256);
 for(let i=0;i<values.length;i+=2){const h=values[i],kind=values[i+1];if(!valid(h)){out[i]=out[i+1]=0;continue;}
  out[i]=Math.max(0,Math.min(255,Math.round((h-min)*scale)));
  const magnitude=Math.abs(kind),exponent=magnitude<=1?0:Math.max(0,Math.min(62,Math.round(Math.log2(magnitude))));out[i+1]=(kind<0?128:0)+1+exponent;
 }
 return out;
}
export function buildExposureIndex(values,size){
 const width=Math.ceil(size/8),levels=[],widths=[];let data=new Float32Array(width*width*4);for(let i=0;i<data.length;i+=4){data[i]=data[i+2]=1e30;data[i+1]=data[i+3]=-1e30;}
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=(y*size+x)*2,h=values[i];if(!valid(h))continue;const b=(Math.floor(y/8)*width+Math.floor(x/8))*4;data[b]=Math.min(data[b],h);data[b+1]=Math.max(data[b+1],h);if(values[i+1]>=0){data[b+2]=Math.min(data[b+2],h);data[b+3]=Math.max(data[b+3],h);}}
 levels.push(data);widths.push(width);let w=width;
 while(w>1){const nw=Math.ceil(w/2),next=new Float32Array(nw*nw*4);for(let y=0;y<nw;y++)for(let x=0;x<nw;x++){const b=(y*nw+x)*4;next[b]=next[b+2]=1e30;next[b+1]=next[b+3]=-1e30;for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const xx=x*2+dx,yy=y*2+dy;if(xx>=w||yy>=w)continue;const a=(yy*w+xx)*4;for(const c of [0,2]){next[b+c]=Math.min(next[b+c],data[a+c]);next[b+c+1]=Math.max(next[b+c+1],data[a+c+1]);}}}data=next;w=nw;levels.push(data);widths.push(w);}
 return {levels,widths,bytes:levels.reduce((sum,a)=>sum+a.byteLength,0)};
}
export function uploadTerrainTexture(device,entry,highPrecision,min,max){
 const format=highPrecision?'rg32float':'rg8unorm';
 if(entry.texture&&entry.textureFormat===format&&(highPrecision||entry.textureMin===min&&entry.textureMax===max))return;
 if(!entry.texture||entry.textureFormat!==format){entry.texture?.destroy();entry.texture=device.createTexture({size:[entry.size,entry.size],format,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC});}
 let data=entry.values;if(!highPrecision){entry.quantized??=new Uint8Array(data.length);data=quantizeTerrain(data,min,max,entry.quantized);}else delete entry.quantized;
 device.queue.writeTexture({texture:entry.texture},data,{bytesPerRow:entry.size*(highPrecision?8:2)},[entry.size,entry.size]);
 entry.textureFormat=format;entry.textureMin=min;entry.textureMax=max;entry.textureVersion=(entry.textureVersion||0)+1;
 entry.bytes=entry.values.byteLength+(entry.exposureIndex?.bytes||0)+(entry.quantized?.byteLength||0)+entry.size*entry.size*(highPrecision?8:2);
}
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
// A geographic rectangle's spherical cap conservatively encloses its projected
// footprint, allowing whole native-data blocks to supply exposure extrema.
function sphereRect(camera,tile,size,x0,y0,x1,y1){
 const n=2**tile.z,lon=((tile.x+(x0+x1)/(2*size))/n-.5)*2*Math.PI,north=Math.atan(Math.sinh(Math.PI*(1-2*(tile.y+y0/size)/n))),south=Math.atan(Math.sinh(Math.PI*(1-2*(tile.y+y1/size)/n))),lat=(north+south)/2;
 const point=[Math.cos(lat)*Math.sin(lon),Math.sin(lat),Math.cos(lat)*Math.cos(lon)],bound=2*Math.sin(Math.min(Math.PI,(north-south)/2+(x1-x0)*Math.PI/(size*n))/2),depth=dot(point,camera.front),r=bound*camera.radius,x=camera.width/2+dot(point,camera.right)*camera.radius,y=camera.height/2-dot(point,camera.up)*camera.radius;
 if(depth+bound<=0||x+r<0||x-r>camera.width||y+r<0||y-r>camera.height)return -1;
 return depth-bound>0&&x-r>=0&&x+r<=camera.width&&y-r>=0&&y+r<=camera.height?1:0;
}
export function nativeExposure({tiles,cache,sphere=null,width,height,dpr=1,noOcean=false}){
 let lo=1e30,hi=-1e30;const channel=noOcean?2:0,available=new Set(tiles.map(t=>t.key));
 function query(entry,tile,rect,flat){
  if(!entry.values)return;if(!entry.exposureIndex){entry.exposureIndex=buildExposureIndex(entry.values,entry.size);if(entry.bytes!==undefined)entry.bytes+=entry.exposureIndex.bytes;}const {levels,widths}=entry.exposureIndex,size=entry.size;
  const include=h=>{lo=Math.min(lo,h);hi=Math.max(hi,h);};
  function visit(level,bx,by){
   const span=8*2**level,x0=bx*span,y0=by*span,x1=Math.min(size,x0+span),y1=Math.min(size,y0+span);
   if(x1<rect[0]||x0>rect[2]||y1<rect[1]||y0>rect[3])return;
   const i=(by*widths[level]+bx)*4+channel,stats=levels[level];if(stats[i]>stats[i+1])return;
   const inside=x0>=rect[0]&&x1<=rect[2]&&y0>=rect[1]&&y1<=rect[3],visibility=flat?1:sphereRect(sphere,tile,size,x0-.5,y0-.5,x1+.5,y1+.5);if(visibility<0)return;
   if(inside&&visibility===1){include(stats[i]);include(stats[i+1]);return;}
   if(level){for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){const xx=bx*2+dx,yy=by*2+dy;if(xx<widths[level-1]&&yy<widths[level-1])visit(level-1,xx,yy);}return;}
   for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
    if(x+1<rect[0]||x>rect[2]||y+1<rect[1]||y>rect[3])continue;const a=(y*size+x)*2,h=entry.values[a];if(!valid(h)||noOcean&&entry.values[a+1]<0)continue;
    if(!flat&&sphereRect(sphere,tile,size,x-.5,y-.5,x+1.5,y+1.5)<0)continue;include(h);
   }
  }
  visit(levels.length-1,0,0);
 }
 if(!sphere){for(const t of tiles){const e=cache.get(t.sourceKey??t.key);if(e?.state!=='ready')continue;const [u,v,s]=t.uv??[0,0,1],left=Math.max(0,-t.left/t.size),top=Math.max(0,-t.top/t.size),right=Math.min(1,(width/dpr-t.left)/t.size),bottom=Math.min(1,(height/dpr-t.top)/t.size);if(right<left||bottom<top)continue;query(e,t,[(u+left*s)*e.size-.5,(v+top*s)*e.size-.5,(u+right*s)*e.size+.5,(v+bottom*s)*e.size+.5],true);}}
 else for(const t of tiles.filter(t=>!t.fallback)){
  let e=cache.get(t.key),source=t;if(e?.state!=='ready'){e=null;for(let z=t.z-1;z>=0;z--){const factor=2**(t.z-z),x=Math.floor(t.x/factor),y=Math.floor(t.y/factor),key=`${z}/${((x%2**z)+2**z)%2**z}/${y}`,parent=cache.get(key);if(parent?.state==='ready'&&available.has(key)){e=parent;source={z,x,y};break;}}}if(!e)continue;
  const factor=2**(t.z-source.z),u=t.x/factor-source.x,v=t.y/factor-source.y;query(e,source,[u*e.size,v*e.size,(u+1/factor)*e.size,(v+1/factor)*e.size],false);
 }
 return [lo,hi];
}

// Byte encoding is a settled-view snapshot, independent of animated display
// exposure. Movement postpones expensive native bounds and tile re-encoding.
export class LowPrecisionUpdates{
 constructor(min,max,delay=180){this.delay=delay;this.reset(min,max);}
 reset(min,max,time=0){this.min=min;this.max=max;this.touch(time);}
 touch(time){this.deadline=time+this.delay;}
 ready(time,moving=false){return !moving&&time>=this.deadline;}
 commit(min,max,time,moving=false,pendingExposure=false){
  if(!this.ready(time,moving)||pendingExposure||!Number.isFinite(min)||!Number.isFinite(max)||max<=min||min===this.min&&max===this.max)return false;
  this.min=min;this.max=max;return true;
 }
}

export function byteTextureReady(entry,min,max){return entry?.state==='ready'&&!!entry.texture&&entry.textureFormat==='rg8unorm'&&entry.textureMin===min&&entry.textureMax===max;}
export function selectByteUploads(entries,min,max,limit){
 const selected=[],seen=new Set();let pending=false;
 for(const entry of entries){if(!entry||seen.has(entry)||entry.state!=='ready')continue;seen.add(entry);if(byteTextureReady(entry,min,max))continue;if(selected.length<limit)selected.push(entry);else pending=true;}
 return {selected,pending};
}
