import {findRegion,prepareRegions,maskRings} from './region-geometry.js';
import {getResource,putResource} from './resource-cache.js';
import {politeFetch} from './request-policy.js';
const datasets=new Map(),pending=new Map();let countries,bytes=0,latest=null,running=false,lastKey='';
async function dataset(iso,level){
 const key=`${iso}/${level}`;
 if(datasets.has(key)){const item=datasets.get(key);datasets.delete(key);datasets.set(key,item);return item.regions;}
 if(pending.has(key))return pending.get(key);
 const promise=(async()=>{
  const metadata=await politeFetch(`https://www.geoboundaries.org/api/current/gbOpen/${iso}/ADM${level}/`,{signal:AbortSignal.timeout(12000)});
  if(!metadata.ok)throw Error(`Boundary catalog HTTP ${metadata.status}`);
  const info=await metadata.json();let url=info.simplifiedGeometryGeoJSON;
  if(!url)throw Error('No polygon dataset');
  url=url.replace('https://github.com/wmgeolab/geoBoundaries/raw/','https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/');
  const diskKey='region-polygons-v1:'+url;let data=(await getResource(diskKey))?.data;
  if(!data){
   const response=await politeFetch(url,{signal:AbortSignal.timeout(25000)});if(!response.ok)throw Error(`Boundary polygons HTTP ${response.status}`);
   const length=Number(response.headers.get('content-length'));if(length>16*1024*1024){await response.body?.cancel();throw Error('Boundary dataset exceeds memory budget');}
   const reader=response.body.getReader(),chunks=[];let received=0;
   while(true){const {value,done}=await reader.read();if(done)break;received+=value.byteLength;if(received>16*1024*1024){await reader.cancel();throw Error('Boundary dataset exceeds memory budget');}chunks.push(value);}
   const combined=new Uint8Array(received);let offset=0;for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.byteLength;}data=combined.buffer;
   void putResource(diskKey,{data},data.byteLength,7*86400000);
  }
  const regions=prepareRegions(JSON.parse(new TextDecoder().decode(data))),cost=data.byteLength*4;
  datasets.set(key,{regions,cost});bytes+=cost;
  while((bytes>48*1024*1024||datasets.size>6)&&datasets.size>1){const [old,item]=datasets.entries().next().value;bytes-=item.cost;datasets.delete(old);}
  return regions;
 })().catch(error=>{datasets.set(key,{regions:null,cost:0});setTimeout(()=>datasets.delete(key),60000);return null;}).finally(()=>pending.delete(key));
 pending.set(key,promise);return promise;
}
async function select(query){
 if(!countries){const response=await fetch(new URL('./data/regions/countries.json',import.meta.url));if(!response.ok)throw Error('Country index unavailable');countries=prepareRegions(await response.json());}
 const country=findRegion(countries,query.longitude,query.latitude);if(!country)return null;
 for(let level=query.level;level>=0;level--){
  if(latest?.id!==query.id)return null;
  const regions=await dataset(country.properties.iso,level);
  const feature=regions&&findRegion(regions,query.longitude,query.latitude);
  if(feature)return {feature,level,iso:country.properties.iso};
 }
 return {feature:country,level:0,iso:country.properties.iso};
}
function rasterize(feature,longitude){
 const shape=maskRings(feature.geometry,longitude),[left,top,width,height]=shape.bounds;
 const longest=2048,w=Math.max(32,Math.round(longest*Math.min(1,width/height))),h=Math.max(32,Math.round(longest*Math.min(1,height/width)));
 const canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext('2d',{alpha:false});
 ctx.fillStyle='black';ctx.fillRect(0,0,w,h);ctx.fillStyle='white';ctx.beginPath();
 for(const shift of [-1,0,1])for(const ring of shape.rings){if(!ring.length)continue;ctx.moveTo((ring[0][0]+shift-left)/width*w,(ring[0][1]-top)/height*h);for(let i=1;i<ring.length;i++)ctx.lineTo((ring[i][0]+shift-left)/width*w,(ring[i][1]-top)/height*h);ctx.closePath();}
 ctx.fill('evenodd');return {image:canvas.transferToImageBitmap(),bounds:shape.bounds,reference:shape.reference};
}
self.onmessage=({data})=>{if(data.cancel){latest=null;return;}if('ack' in data){lastKey=data.ack;return;}latest=data;if(!running)void run();};
async function run(){
 running=true;
 while(latest){
  const query=latest;
  try{
   const selected=await select(query);if(latest?.id!==query.id)continue;
   if(!selected){lastKey='';self.postMessage({id:query.id,empty:true});}
   else{
    const {feature,iso,level}=selected,key=`${iso}/${level}/${feature.properties.shapeID??feature.properties.name}`;
    if(key===lastKey)self.postMessage({id:query.id,key,same:true});
    else{const mask=rasterize(feature,query.longitude);self.postMessage({id:query.id,key,name:feature.properties.shapeName??feature.properties.name,level,...mask},[mask.image]);}
   }
  }catch(error){if(latest?.id===query.id)self.postMessage({id:query.id,error:error.message});}
  if(latest?.id===query.id)latest=null;
 }
 running=false;
}
