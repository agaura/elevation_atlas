import {BODIES,mercatorY} from './planetary.js';
import {projectProbe} from './probe.js';

const catalogs=new Map();
const regionalTypes=new Set(['AL','ME','OC','PL','PM','TA','TE','VS','RE']);
const mountainTypes=new Set(['MO','TH','DO','PA']);

// Local snapshots avoid runtime dependency on a third-party nomenclature API.
// Fetch only the selected body's catalog, and share it across toggle cycles.
export async function loadPlanetaryNames(body){
 if(!['mars','moon'].includes(body))throw Error('Unknown planetary label catalog');
 if(!catalogs.has(body)){
  const pending=fetch(new URL(`./data/planetary/${body}-names.json`,import.meta.url)).then(async response=>{
   if(!response.ok)throw Error(`Planetary names HTTP ${response.status}`);
   const data=await response.json();
   return data.features.map(([name,longitude,latitude,diameterKm,typeCode,id])=>({
    name,diameterKm,typeCode,id,
    x:((longitude/360+.5)%1+1)%1,
    y:mercatorY(Math.max(-89.999999,Math.min(89.999999,latitude)))
   }));
  }).catch(error=>{catalogs.delete(body);throw error;});
  catalogs.set(body,pending);
 }
 return catalogs.get(body);
}

export function planetaryLabelStyle(feature,pixels){
 const {typeCode,diameterKm}=feature;
 const regional=regionalTypes.has(typeCode),mountain=mountainTypes.has(typeCode);
 const minimum=regional?100:typeCode==='SF'?65:mountain?22:32;
 if(pixels<minimum)return null;
 const priority=(regional?0:mountain?1:2)+1/(1+diameterKm/200);
 return {size:regional?13:10.5,weight:regional?500:400,
  family:regional?'"Atlas Rajdhani", sans-serif':'"Atlas Plex Mono", monospace',
  spacing:regional?.6:.25,upper:regional,color:'#8fc5ff',priority};
}

export function planetaryLabelCandidates(features,body,{view,width,height,camera,zoom}){
 const radius=BODIES[body].radius,cosLat=1/Math.cosh(Math.PI*(1-2*view.y));
 const metresPerPixel=camera?radius/camera.radius:2*Math.PI*radius*cosLat/(256*2**zoom);
 const sphereZoom=camera?Math.log2(camera.radius/(.46*Math.min(width,height))):0;
 const labels=[];
 for(const feature of features){
  const style=planetaryLabelStyle(feature,feature.diameterKm*1000/metresPerPixel);if(!style)continue;
  const point=projectProbe(feature,view,width,height,sphereZoom,!!camera);if(!point)continue;
  labels.push({...style,name:feature.name,point:[point.x,point.y],iauId:feature.id});
 }
 return labels;
}
