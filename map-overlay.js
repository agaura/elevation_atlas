import {visibleTiles,wrap} from './terrain.js';
import {sphereTiles} from './sphere.js';
import {buildMapGeometry} from './map-geometry.js';
export const MAP_TILEJSON='https://tiles.openfreemap.org/planet/latest';
const empty=[],pathBounds=new WeakMap(),sphereBounds=new WeakMap();
function boundsForPath(path){
 let b=pathBounds.get(path);if(!b){b=[Infinity,Infinity,-Infinity,-Infinity];for(let i=0;i<path.length;i+=2){b[0]=Math.min(b[0],path[i]);b[1]=Math.min(b[1],path[i+1]);b[2]=Math.max(b[2],path[i]);b[3]=Math.max(b[3],path[i+1]);}pathBounds.set(path,b);}return b;
}
export function pathIntersects(path,viewport){
 const b=boundsForPath(path);return b[0]<=viewport[2]&&b[2]>=viewport[0]&&b[1]<=viewport[3]&&b[3]>=viewport[1];
}
export function spherePathIntersects(path,tile,extent,camera,padding=32){
 let cap=sphereBounds.get(path);const key=`${tile.z}/${wrap(tile.x,2**tile.z)}/${tile.y}/${extent}`;
 if(!cap||cap.key!==key){
  const b=boundsForPath(path),n=2**tile.z,lon=((tile.x+(b[0]+b[2])/(2*extent))/n-.5)*2*Math.PI;
  const north=Math.atan(Math.sinh(Math.PI*(1-2*(tile.y+b[1]/extent)/n))),south=Math.atan(Math.sinh(Math.PI*(1-2*(tile.y+b[3]/extent)/n))),lat=(north+south)/2;
  // Every source-space segment lies inside this geographic rectangle. Its angular
  // cap therefore encloses the projected curve, including intermediate vertices.
  const angle=Math.min(Math.PI,(north-south)/2+(b[2]-b[0])*Math.PI/(extent*n));
  cap={key,point:[Math.cos(lat)*Math.sin(lon),Math.sin(lat),Math.cos(lat)*Math.cos(lon)],bound:2*Math.sin(angle/2)};sphereBounds.set(path,cap);
 }
 if(dot(cap.point,camera.front)+cap.bound<=.005)return false;
 const x=camera.width/2+dot(cap.point,camera.right)*camera.radius,y=camera.height/2-dot(cap.point,camera.up)*camera.radius,r=cap.bound*camera.radius+padding;
 return x+r>=0&&x-r<=camera.width&&y+r>=0&&y-r<=camera.height;
}
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export function mapProject(view,width,height,camera,tile,extent,x,y){
 const n=2**tile.z,u=(tile.x+x/extent)/n,v=(tile.y+y/extent)/n;
 if(!camera){const scale=256*2**view.zoom;return [(u-view.x)*scale+width/2,(v-view.y)*scale+height/2];}
 const lat=Math.atan(Math.sinh(Math.PI*(1-2*v))),lon=(u-.5)*Math.PI*2,cl=Math.cos(lat),point=[cl*Math.sin(lon),Math.sin(lat),cl*Math.cos(lon)];
 if(dot(point,camera.front)<=.005)return null;
 return [camera.width/2+dot(point,camera.right)*camera.radius,camera.height/2-dot(point,camera.up)*camera.radius];
}
export function roadWidth(kind,zoom){
 const min={motorway:3,trunk:4,primary:5,secondary:7,tertiary:8,minor:10,service:12,track:13,path:14,rail:8,transit:12};
 if(zoom<(min[kind]??11)+1)return 0;
 return .5*(({motorway:1.3,trunk:1.1,primary:.95,secondary:.8,tertiary:.7,rail:.55})[kind]??.6);
}
const uiFont='"Atlas Plex Mono", monospace';
const mapLabelColor='#8fc5ff';
const aerospaceFont='"Atlas Rajdhani", sans-serif';
export function placeStyle(properties,zoom){
 const kind=properties.class,rank=Number(properties.rank)||10;
 if(kind==='continent')return zoom<=3?{size:16.5,weight:500,family:aerospaceFont,spacing:.8,upper:true,color:mapLabelColor,priority:0}:null;
 if(kind==='country')return zoom<=9?{size:zoom<3?14.5:15.5,weight:500,family:aerospaceFont,spacing:.35,upper:false,color:mapLabelColor,priority:1}:null;
 if(kind==='state'||kind==='province')return zoom>=5&&zoom<=10?{size:14.5,weight:500,family:aerospaceFont,spacing:.2,upper:false,color:mapLabelColor,priority:2,boundary:true}:null;
 zoom-=1;
 if(kind==='city')return zoom>=5?{size:11.5,weight:400,family:uiFont,spacing:.5,upper:true,color:mapLabelColor,priority:3+rank/100,roads:true}:null;
 if(kind==='town')return zoom>=8?{size:10.5,weight:400,family:uiFont,spacing:.25,color:mapLabelColor,priority:4,roads:true}:null;
 if(kind==='village')return zoom>=10?{size:10,weight:400,family:uiFont,color:mapLabelColor,priority:5,roads:true}:null;
 return zoom>=13?{size:10,weight:400,family:uiFont,color:mapLabelColor,priority:6,roads:true}:null;
}
export class RoadContext{
 constructor(width,height,targets=null){
  this.width=width;this.height=height;this.cells=new Map();this.targets=targets;this.columns=Math.ceil(width/32)+1;
  if(targets){this.hits=new Set();this.remaining=targets.length;for(const point of targets){const key=Math.floor(point[1]/32)*this.columns+Math.floor(point[0]/32);if(!this.cells.has(key))this.cells.set(key,[]);this.cells.get(key).push(point);}}
 }
 add(a,b){
  if(this.targets){
   if(!this.remaining)return;
   const minX=Math.max(0,Math.floor((Math.min(a[0],b[0])-24)/32)),maxX=Math.min(this.columns-1,Math.floor((Math.max(a[0],b[0])+24)/32));
   const minY=Math.max(0,Math.floor((Math.min(a[1],b[1])-24)/32)),maxY=Math.min(Math.floor(this.height/32),Math.floor((Math.max(a[1],b[1])+24)/32));
   const dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy||1;
   for(let cy=minY;cy<=maxY;cy++)for(let cx=minX;cx<=maxX;cx++)for(const point of this.cells.get(cy*this.columns+cx)||empty){
    if(this.hits.has(point))continue;const t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/length2));
    if((point[0]-a[0]-t*dx)**2+(point[1]-a[1]-t*dy)**2<=576){this.hits.add(point);this.remaining--;}
   }
   return;
  }
  const dx=b[0]-a[0],dy=b[1]-a[1];let lo=0,hi=1;
  for(const [p,q] of [[-dx,a[0]+24],[dx,this.width+24-a[0]],[-dy,a[1]+24],[dy,this.height+24-a[1]]]){
   if(p===0){if(q<0)return;continue;}const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return;
  }
  const first=[a[0]+lo*dx,a[1]+lo*dy],last=[a[0]+hi*dx,a[1]+hi*dy],segment=[...first,...last];
  const steps=Math.max(1,Math.ceil(Math.hypot(last[0]-first[0],last[1]-first[1])/16)),seen=new Set();
  for(let i=0;i<=steps;i++){
   const key=`${Math.floor((first[0]+(last[0]-first[0])*i/steps)/32)}/${Math.floor((first[1]+(last[1]-first[1])*i/steps)/32)}`;
   if(seen.has(key))continue;seen.add(key);if(!this.cells.has(key))this.cells.set(key,[]);this.cells.get(key).push(segment);
  }
 }
 near(point,radius=24){
  if(this.targets)return this.hits.has(point);
  const [x,y]=point;
  for(let cy=Math.floor((y-radius)/32);cy<=Math.floor((y+radius)/32);cy++)for(let cx=Math.floor((x-radius)/32);cx<=Math.floor((x+radius)/32);cx++)for(const [ax,ay,bx,by] of this.cells.get(`${cx}/${cy}`)||empty){
   const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1)));
   if((x-ax-t*dx)**2+(y-ay-t*dy)**2<=radius*radius)return true;
  }
  return false;
 }
}
export class MapOverlay{
 constructor(onChange,onStatus){this.onChange=onChange;this.onStatus=onStatus;this.enabled=false;this.textWidths=new Map();this.entries=new Map();this.pending=new Map();this.queue=[];this.serial=0;this.active=0;this.dirty=true;this.revision=0;this.metrics=new OffscreenCanvas(1,1).getContext('2d');}
 async enable(enabled){
  this.enabled=enabled;this.dirty=true;
  if(!enabled){clearTimeout(this.retryTimer);this.retryTimer=null;for(const [id,pending] of this.pending){this.worker?.postMessage({id,cancel:true});this.entries.delete(pending.key);}this.pending.clear();this.active=0;this.queue=[];this.scene=null;this.signature='';this.revision++;this.onStatus('');return;}
  if(!this.fontsReady)this.fontsReady=Promise.all([document.fonts.load('500 14px "Atlas Rajdhani"'),document.fonts.load('400 12px "Atlas Plex Mono"')]).catch(()=>{}).then(()=>{this.fontRevision=(this.fontRevision||0)+1;this.textWidths.clear();this.dirty=true;if(this.enabled)this.onChange();});
  if(!this.worker){this.worker=new Worker(new URL('./map.worker.js',import.meta.url),{type:'module'});this.worker.onmessage=event=>this.loaded(event.data);}
  if(!this.metadata){this.onStatus('Loading map data…');try{const response=await fetch(MAP_TILEJSON,{signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error(`Map metadata HTTP ${response.status}`);const metadata=await response.json();if(!metadata.tiles?.length)throw Error('Map tile source unavailable');this.metadata=metadata;}catch(error){if(this.enabled)this.onStatus(`Map unavailable: ${error.message}`);return;}}
  await this.fontsReady;if(this.enabled){this.dirty=true;this.onChange();}
 }
 loaded(data){
  const entry=this.pending.get(data.id);if(!entry)return;this.pending.delete(data.id);this.active--;
  if(data.error){entry.state='failed';entry.failures=(entry.failures||0)+1;entry.retry=performance.now()+Math.min(30000,1000*2**Math.min(entry.failures-1,5));}
  else{const geometry=data.geometry||buildMapGeometry(data.layers,entry.tile.z);Object.assign(entry,{state:'ready',layers:data.layers,geometry,bytes:data.bytes*6+geometry.segments.byteLength*2+[...geometry.grid.values()].reduce((sum,indices)=>sum+indices.byteLength,0)});this.dirty=true;}
  this.scheduleRetry();this.onChange();this.pump();
 }
 scheduleRetry(){
  clearTimeout(this.retryTimer);this.retryTimer=null;
  if(!this.enabled)return;
  const failed=[...this.entries.values()].filter(e=>e.state==='failed'&&this.needed?.has(e.key));
  if(failed.length)this.retryTimer=setTimeout(()=>{this.dirty=true;this.onChange();},Math.max(0,Math.min(...failed.map(e=>e.retry))-performance.now()));
 }
 pump(){
  while(this.enabled&&this.active<4&&this.queue.length){const entry=this.queue.shift();if(entry.state!=='queued')continue;entry.state='loading';const id=++this.serial;this.pending.set(id,entry);this.active++;const url=this.metadata.tiles[0].replace('{z}',entry.tile.z).replace('{x}',wrap(entry.tile.x,2**entry.tile.z)).replace('{y}',entry.tile.y);this.worker.postMessage({id,url,z:entry.tile.z});}
 }
 draw({view,width,height,dpr,camera}){
  if(!this.enabled||!this.metadata)return null;
  const cssCamera=camera?{...camera,width:width,height:height,radius:camera.radius/dpr}:null;
  const zoom=cssCamera?Math.log2(2*Math.PI*cssCamera.radius/256):view.zoom;
  const z=Math.max(this.metadata.minzoom??0,Math.min(this.metadata.maxzoom??14,Math.floor(zoom)));
  const signature=[view.x,view.y,view.zoom,width,height,dpr,cssCamera?.radius??0].join('/');
  if(signature===this.signature&&!this.dirty)return this.scene;
  this.signature=signature;this.dirty=false;
  const tiles=cssCamera?sphereTiles(cssCamera,this.metadata.maxzoom??14,256):visibleTiles(view,width,height,z);
  this.needed=new Set(tiles.map(t=>t.key));this.queue=[];
  for(const [id,entry] of this.pending)if(!this.needed.has(entry.key)){this.worker.postMessage({id,cancel:true});this.pending.delete(id);this.entries.delete(entry.key);this.active--;}
  for(const tile of tiles){let entry=this.entries.get(tile.key);if(!entry){entry={key:tile.key,tile,state:'queued'};this.entries.set(tile.key,entry);}if(entry.state==='failed'&&performance.now()>=entry.retry)entry.state='queued';if(entry.state==='queued'&&!this.queue.includes(entry))this.queue.push(entry);entry.used=performance.now();}
  let bytes=[...this.entries.values()].reduce((sum,e)=>sum+(e.bytes||0),0);
  for(const [key,entry] of [...this.entries].sort((a,b)=>a[1].used-b[1].used)){if(bytes<64*1024*1024&&this.entries.size<=192)break;if(!this.needed.has(key)&&entry.state!=='loading'){bytes-=entry.bytes||0;this.entries.delete(key);}}
  this.pump();this.scheduleRetry();
  const labels=[],readyTiles=[];let stateBorders=false,ready=0,failed=0,roads=0,borders=0;
  for(const tile of tiles){
   const entry=this.entries.get(tile.key);if(entry?.state==='failed')failed++;if(entry?.state!=='ready')continue;ready++;
   if(!entry.geometry)entry.geometry=buildMapGeometry(entry.layers,tile.z);
   const sourceTile={tile,entry};readyTiles.push(sourceTile);stateBorders||=zoom>=5&&entry.geometry.stateBorders;
   for(const [key,count] of entry.geometry.groups){const [channel,minzoom]=key.split('/').map(Number);if(zoom>=minzoom){if(channel===0)roads+=count;else borders+=count;}}
   for(const layer of entry.layers){
    if(layer.name!=='place'&&layer.name!=='water_name'&&!(layer.name==='transportation_name'&&zoom>=13))continue;
    const project=(x,y)=>mapProject(view,width,height,cssCamera,tile,layer.extent,x,y),origin=cssCamera?null:project(0,0),scale=256*2**view.zoom/(2**tile.z*layer.extent);
    const viewport=origin?[(-32-origin[0])/scale,(-32-origin[1])/scale,(width+32-origin[0])/scale,(height+32-origin[1])/scale]:null;
    for(const feature of layer.features){
     const p=feature.properties,name=p['name:en']||p.name||(layer.name==='transportation_name'?p.ref:null);if(!name)continue;
     if(layer.name==='transportation_name'){
      for(const path of feature.paths){if(viewport?!pathIntersects(path,viewport):!spherePathIntersects(path,tile,layer.extent,cssCamera))continue;let best,previous;
       for(let i=0;i<path.length;i+=2){const point=project(path[i],path[i+1]);if(previous&&point){const length=Math.hypot(point[0]-previous[0],point[1]-previous[1]);if(!best||length>best.length)best={a:previous,b:point,length};}previous=point;}
       if(best&&best.length>String(name).length*6+12){let angle=Math.atan2(best.b[1]-best.a[1],best.b[0]-best.a[0]);if(angle>Math.PI/2)angle-=Math.PI;if(angle< -Math.PI/2)angle+=Math.PI;labels.push({name:String(name),point:[(best.a[0]+best.b[0])/2,(best.a[1]+best.b[1])/2],size:9,weight:400,family:uiFont,color:mapLabelColor,priority:10,angle});}
      }
      continue;
     }
     const style=layer.name==='place'?placeStyle(p,zoom):zoom>=6?{size:10.5,weight:400,family:uiFont,spacing:.25,color:mapLabelColor,priority:7}:null;
     const path=feature.paths[0];if(!style||!path?.length)continue;const x=path[0],y=path[1];if(x<0||y<0||x>=layer.extent||y>=layer.extent)continue;
     const point=project(x,y);if(!point||point[0]<8||point[1]<10||point[0]>width-8||point[1]>height-10)continue;
     labels.push({...style,name:String(name),point,sourceTile,u:(tile.x+x/layer.extent)/2**tile.z,v:(tile.y+y/layer.extent)/2**tile.z});
    }
   }
  }
  const occupied=new Map(),names=new Set(),placed=[],ctx=this.metrics;
  for(const label of labels.sort((a,b)=>a.priority-b.priority||a.name.localeCompare(b.name))){
   if(label.boundary&&!stateBorders)continue;
   const [x,y]=label.point;if(x<8||y<10||x>width-8||y>height-10)continue;
   const text=label.upper?label.name.toLocaleUpperCase():label.name,key=label.name.toLocaleLowerCase();if(names.has(key))continue;
   const font=`${label.weight||400} ${label.size}px ${label.family||uiFont}`,spacing=`${label.spacing||0}px`,metricKey=`${font}/${spacing}/${text}`;
   let textWidth=this.textWidths.get(metricKey);if(textWidth===undefined){ctx.font=font;ctx.letterSpacing=spacing;textWidth=ctx.measureText(text).width;this.textWidths.set(metricKey,textWidth);if(this.textWidths.size>8192)this.textWidths.delete(this.textWidths.keys().next().value);}
   const tw=textWidth+10,th=label.size+8,angle=label.angle||0,bw=Math.abs(Math.cos(angle))*tw+Math.abs(Math.sin(angle))*th,bh=Math.abs(Math.sin(angle))*tw+Math.abs(Math.cos(angle))*th,box=[x-bw/2,y-bh/2,x+bw/2,y+bh/2];
   if(cssCamera&&[[box[0],box[1]],[box[2],box[1]],[box[0],box[3]],[box[2],box[3]]].some(([bx,by])=>Math.hypot(bx-width/2,by-height/2)>cssCamera.radius-2))continue;
   const cells=[];let overlap=false;for(let cy=Math.floor(box[1]/32);cy<=Math.floor(box[3]/32);cy++)for(let cx=Math.floor(box[0]/32);cx<=Math.floor(box[2]/32);cx++){const cell=`${cx}/${cy}`;cells.push(cell);for(const other of occupied.get(cell)||empty)if(box[0]<other[2]&&box[2]>other[0]&&box[1]<other[3]&&box[3]>other[1])overlap=true;}
   if(overlap||label.roads&&!labelNearRoad(label,readyTiles,{view,width,height,camera:cssCamera,zoom}))continue;
   for(const cell of cells){if(!occupied.has(cell))occupied.set(cell,[]);occupied.get(cell).push(box);}names.add(key);
   placed.push({...label,text,font,spacing,textWidth});
  }
  this.stats={roads,borders,labels:placed.length,ready,total:tiles.length};
  this.onStatus(failed?`Map: ${failed} tile(s) retrying…`:ready<tiles.length?'Loading map data…':'');
  this.revision++;this.scene={gpu:true,revision:this.revision,fontRevision:this.fontRevision||0,tiles:readyTiles,entries:new Set(this.entries.values()),labels:placed,view:{...view},width,height,dpr,camera:cssCamera,zoom};return this.scene;
 }
}

// Only label candidates which survived collision placement need a road query.
// The immutable grid lives in source-tile space and is built by the tile worker.
export function labelNearRoad(label,tiles,{view,width,height,camera,zoom}){
 const latitude=Math.atan(Math.sinh(Math.PI*(1-2*label.v))),cosLat=Math.cos(latitude);
 let worldRadius=24/(256*2**view.zoom);
 if(camera){
  const screenRadius=Math.hypot(label.point[0]-width/2,label.point[1]-height/2)/camera.radius,depth=Math.sqrt(Math.max(0,1-screenRadius*screenRadius));
  const span=24/camera.radius,lowerDepth=Math.max(.005,depth-2*span),lowerCos=Math.max(.005,cosLat-2*span/lowerDepth);
  worldRadius=2*span/(2*Math.PI*lowerCos*lowerDepth);
 }
 for(let tileIndex=-1;tileIndex<tiles.length;tileIndex++){
  const candidate=tileIndex<0?label.sourceTile:tiles[tileIndex];if(!candidate||tileIndex>=0&&candidate===label.sourceTile)continue;const {tile,entry}=candidate;
  const n=2**tile.z,centerX=.5+(wrap(label.u-(tile.x+.5)/n+.5,1)-.5)*n,centerY=label.v*n-tile.y,r=worldRadius*n;
  // MVT line buffers can extend beyond a tile; include them in the grid query.
  const geometry=entry.geometry,seen=new Set(),project=(x,y)=>mapProject(view,width,height,camera,tile,1,x,y);
  if(!geometry.grid.size)continue;const bounds=geometry.gridBounds;
  const minX=Math.max(bounds[0],Math.floor((centerX-r)*16)),maxX=Math.min(bounds[2],Math.floor((centerX+r)*16)),minY=Math.max(bounds[1],Math.floor((centerY-r)*16)),maxY=Math.min(bounds[3],Math.floor((centerY+r)*16));
  if(minX>maxX||minY>maxY)continue;
  const cx=Math.max(minX,Math.min(maxX,Math.floor(centerX*16))),cy=Math.max(minY,Math.min(maxY,Math.floor(centerY*16))),radius=Math.max(cx-minX,maxX-cx,cy-minY,maxY-cy);
  const offsets=radius<=32?nearbyCells(radius):[...geometry.grid.keys()].map(key=>key.split('/').map(Number)).filter(([x,y])=>x>=minX&&x<=maxX&&y>=minY&&y<=maxY).map(([x,y])=>[x-cx,y-cy]).sort((a,b)=>a[0]*a[0]+a[1]*a[1]-b[0]*b[0]-b[1]*b[1]);
  for(const [dx,dy] of offsets){const x=cx+dx,y=cy+dy;if(x<minX||x>maxX||y<minY||y>maxY)continue;
  for(const index of geometry.grid.get(`${x}/${y}`)||empty){
   if(seen.has(index))continue;seen.add(index);const i=index*8,s=geometry.segments;if(zoom<s[i+5])continue;
   const a=project(s[i],s[i+1]),b=project(s[i+2],s[i+3]);if(!a||!b)continue;
   if(camera&&Math.sqrt(Math.max(0,1-((b[0]-width/2)**2+(b[1]-height/2)**2)/camera.radius**2))<=.25)continue;
   const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((label.point[0]-a[0])*dx+(label.point[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
   if((label.point[0]-a[0]-t*dx)**2+(label.point[1]-a[1]-t*dy)**2<=576)return true;
  }
  }
 }
 return false;
}

const cellOrder=new Map();
function nearbyCells(radius){
 // Check the label's own cell first, rather than walking in from the far corner
 // of the search rectangle. Settlement centers usually sit directly on a road.
 let offsets=cellOrder.get(radius);if(!offsets){offsets=[];for(let y=-radius;y<=radius;y++)for(let x=-radius;x<=radius;x++)offsets.push([x,y]);offsets.sort((a,b)=>a[0]*a[0]+a[1]*a[1]-b[0]*b[0]-b[1]*b[1]);if(radius<=32)cellOrder.set(radius,offsets);}return offsets;
}
