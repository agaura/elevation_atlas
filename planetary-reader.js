import {BODIES,latitudeAt,meshBounds,availableMeshAddress,planetaryMeshCover,planetaryMeshZoom,decodeTerrainMesh,rasterizeMesh} from './planetary.js';
import {getResource,putResource} from './resource-cache.js';
import {politeFetch} from './request-policy.js';
import {fromUrl} from './vendor/geotiff/geotiff.js';
const manifests=new Map(),meshes=new Map(),catalogs=new Map(),readers=new Map();
let meshBytes=0;
async function manifestFor(body,signal){
 if(manifests.has(body))return manifests.get(body);
 const response=await politeFetch(BODIES[body].terrain+'layer.json',{signal});if(!response.ok)throw Error(`Planetary manifest HTTP ${response.status}`);
 const data=await response.json();if(data.format!=='quantized-mesh-1.0'||data.projection!=='EPSG:4326'||data.scheme!=='tms')throw Error('Unsupported planetary terrain grid');
 manifests.set(body,data);return data;
}
async function readMesh(body,z,x,y,signal){
 const manifest=await manifestFor(body,signal);
 ({z,x,y}=availableMeshAddress(manifest,z,x,y));
 const key=`${body}/${z}/${x}/${y}`,existing=meshes.get(key);
 if(existing){meshes.delete(key);meshes.set(key,existing);return existing;}
 const url=BODIES[body].terrain+`${z}/${x}/${y}.terrain?v=${manifest.version}`,diskKey='planet-mesh-v1:'+url;
 let bytes=(await getResource(diskKey))?.data;signal.throwIfAborted();
 if(!bytes){const response=await politeFetch(url,{signal});if(!response.ok)throw Object.assign(Error(`Planetary tile HTTP ${response.status}`),{status:response.status});bytes=await response.arrayBuffer();if(bytes.byteLength>16*1024*1024)throw Error('Planetary tile exceeds size limit');void putResource(diskKey,{data:bytes},bytes.byteLength,7*86400000);}
 const decoded=decodeTerrainMesh(bytes);
 const offset=BODIES[body].meshOffset??0;
 if(offset){for(let i=2;i<decoded.positions.length;i+=3)decoded.positions[i]-=offset;decoded.minimum-=offset;decoded.maximum-=offset;}
 const mesh={...decoded,bounds:meshBounds(z,x,y),z,x,y},size=mesh.positions.byteLength+mesh.indices.byteLength;
 signal.throwIfAborted();const previous=meshes.get(key);if(previous)meshBytes-=previous.positions.byteLength+previous.indices.byteLength;meshes.set(key,mesh);meshBytes+=size;
 while(meshBytes>32*1024*1024&&meshes.size>1){const [oldKey,old]=meshes.entries().next().value;meshBytes-=old.positions.byteLength+old.indices.byteLength;meshes.delete(oldKey);}
 return mesh;
}
export async function planetaryTile(tile,size,body,signal,onProgress=()=>{},refine=false){
 const settings=BODIES[body];if(!settings?.terrain)throw Error('Unknown celestial body');
 const manifest=await manifestFor(body,signal),n=2**tile.z,x=((tile.x%n)+n)%n;
 const west=x/n*360-180,east=(x+1)/n*360-180,north=latitudeAt(tile.y/n),south=latitudeAt((tile.y+1)/n);
 const addresses=planetaryMeshCover({...tile,x},size,manifest),baseZoom=planetaryMeshZoom(tile.z,manifest);
 const heights=new Float32Array(size*size).fill(NaN);let coarse=false;
 // Two reads per output tile; the existing foreground queue has at most four
 // output tiles active. Rasterization stays sequential and memory stays bounded.
 for(let i=0;i<addresses.length;i+=2){
  signal.throwIfAborted();
  const batch=await Promise.all(addresses.slice(i,i+2).map(async address=>{
   const mesh=await readMesh(body,address.z,address.x,address.y,signal);onProgress();return mesh;
  }));
  signal.throwIfAborted();
  for(const mesh of batch){coarse||=mesh.z<baseZoom;rasterizeMesh(mesh,mesh.bounds,{...tile,x},size,heights);}
 }
 let refined=0;
 if(refine)try{refined=await refineRasters({west,east,north,south,tile:{...tile,x},size,heights,body,signal,onProgress});}catch(error){if(signal.aborted)throw error;console.warn('Planetary refinement unavailable',error);throw error;}
 const values=new Float32Array(size*size*2);
 for(let i=0;i<heights.length;i++){values[i*2]=Number.isFinite(heights[i])?heights[i]:1e30;values[i*2+1]=1;}
 return {size,values,overzoomed:coarse,oceanSource:refine?'planetary-refined':'planetary',refinedSamples:refined,body};
}
async function refineRasters({west,east,north,south,tile,size,heights,body,signal,onProgress}){
 const settings=BODIES[body],bbox=[west,south,east,north],key=`${body}:${tile.z}/${tile.x}/${tile.y}`;
 let features=catalogs.get(key);
 if(!features){
  const url=new URL(`https://stac.astrogeology.usgs.gov/api/collections/${settings.collection}/items`);url.searchParams.set('bbox',bbox.join(','));url.searchParams.set('limit','8');
  const response=await politeFetch(url.href,{signal});if(!response.ok)throw Error(`Planetary catalog HTTP ${response.status}`);
  features=(await response.json()).features??[];catalogs.set(key,features);if(catalogs.size>128)catalogs.delete(catalogs.keys().next().value);onProgress();
 }
 // Bound per-tile work. Prefer finer scenes, with deterministic overlap order.
 features=features.filter(f=>f.assets?.[settings.asset]).sort((a,b)=>(a.properties?.gsd??100)-(b.properties?.gsd??100)||a.id.localeCompare(b.id)).slice(0,2).reverse();
 let refined=0;
 for(const feature of features){
  signal.throwIfAborted();const url=feature.assets[settings.asset].href;
  let reader=readers.get(url);
  if(!reader){
   // Astrogeology permits ranges but does not expose Content-Range to CORS.
   // GeoTIFF's ordinary ranged source supports that case and still rejects full files.
   const tiff=await fromUrl(url,{allowFullFile:false,blockSize:65536,cacheSize:64});const image=await tiff.getImage();onProgress();
   reader={tiff,image,count:await tiff.getImageCount()};readers.set(url,reader);if(readers.size>3)readers.delete(readers.keys().next().value);
  }
  const reference=reader.image,keys=reference.getGeoKeys();
  // These collections are equirectangular; reject unfamiliar projections.
  if(keys.ProjCoordTransGeoKey!==17)continue;
  const radius=keys.GeogSemiMajorAxisGeoKey,meridian=keys.ProjCenterLongGeoKey??0,parallel=keys.ProjStdParallel1GeoKey??0;
  if(!Number.isFinite(radius))continue;
  const projectedX=longitude=>(((longitude-meridian+540)%360)-180)*Math.PI/180*radius*Math.cos(parallel*Math.PI/180)+(keys.ProjFalseEastingGeoKey??0);
  const projectedY=latitude=>latitude*Math.PI/180*radius+(keys.ProjFalseNorthingGeoKey??0);
  const fullResolution=reference.getResolution(),spacing=Math.min(Math.abs((east-west)*Math.PI/180*radius/size),Math.abs((north-south)*Math.PI/180*radius/size));
  let overview=Math.max(0,Math.min(reader.count-1,Math.floor(Math.log2(spacing/Math.abs(fullResolution[0])))));
  let image=await reader.tiff.getImage(overview),resolution=image.getResolution(reference),origin=reference.getOrigin();
  let xs=Float64Array.from({length:size},(_,i)=>(projectedX(west+(east-west)*(i+.5)/size)-origin[0])/resolution[0]-.5);
  let ys=Float64Array.from({length:size},(_,i)=>(projectedY(latitudeAt((tile.y+(i+.5)/size)/2**tile.z))-origin[1])/resolution[1]-.5);
  const x0=Math.max(0,Math.floor(Math.min(...xs))),x1=Math.min(image.getWidth(),Math.ceil(Math.max(...xs))+2),y0=Math.max(0,Math.floor(Math.min(...ys))),y1=Math.min(image.getHeight(),Math.ceil(Math.max(...ys))+2);
  if(x1<=x0||y1<=y0||(x1-x0)*(y1-y0)>2e6)continue;
  const data=await image.readRasters({window:[x0,y0,x1,y1],samples:[0],interleave:true,signal}),nodata=image.getGDALNoData();onProgress();
  for(let row=0;row<size;row++)for(let col=0;col<size;col++){
   const xx=xs[col],yy=ys[row],ix=Math.floor(xx),iy=Math.floor(yy);if(ix<x0||iy<y0||ix+1>=x1||iy+1>=y1)continue;
   const at=(x,y)=>data[(y-y0)*(x1-x0)+x-x0];const a=at(ix,iy),b=at(ix+1,iy),c=at(ix,iy+1),d=at(ix+1,iy+1);
   if(![a,b,c,d].every(v=>Number.isFinite(v)&&v!==nodata&&Math.abs(v)<100000))continue;
   const fx=xx-ix,fy=yy-iy;
   // Mars uses the MOLA/areoid-adjusted asset; lunar DTMs use their reference sphere.
   heights[row*size+col]=(a*(1-fx)+b*fx)*(1-fy)+(c*(1-fx)+d*fx)*fy;refined++;
  }
 }
 return refined;
}
