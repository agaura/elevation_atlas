import {wrap} from './terrain.js';
export const GEOCODER_URL='https://photon.komoot.io/api/';
const limit=85.05112878;
function coordinate(latitude,longitude){
 if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)throw Error('Latitude must be −90 to 90; longitude −180 to 180.');
 if(Math.abs(latitude)>limit)throw Error('Terrain coverage ends at ±85.05113° latitude.');
 return {latitude,longitude};
}
export function parseCoordinates(query){
 const text=query.trim().replace(/^geo:/i,'').replace(/^[([]|[)\]]$/g,'').trim();
 let match=text.match(/^([+-]?\d+(?:\.\d+)?)\s*[,;]\s*([+-]?\d+(?:\.\d+)?)$/)||text.match(/^([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)$/);
 if(match)return coordinate(Number(match[1]),Number(match[2]));
 const parts=[...text.matchAll(/([+-]?\d+(?:\.\d+)?)\s*(?:[°º]\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*["″]\s*)?)?([NSEW])/gi)];
 if(parts.length===2&&text.replace(/([+-]?\d+(?:\.\d+)?)\s*(?:[°º]\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*["″]\s*)?)?([NSEW])/gi,'').replace(/[,;\s]/g,'')===''){
  const result={};for(const p of parts){const min=Number(p[2]||0),sec=Number(p[3]||0),direction=p[4].toUpperCase();if(min>=60||sec>=60)throw Error('Coordinate minutes and seconds must be below 60.');const key=/[NS]/.test(direction)?'latitude':'longitude';if(key in result)throw Error('Specify one latitude and one longitude.');result[key]=(Math.abs(Number(p[1]))+min/60+sec/3600)*(/[SW]/.test(direction)?-1:1);}
  return coordinate(result.latitude,result.longitude);
 }
 return null;
}
export function mercator(latitude,longitude){return {x:wrap((longitude+180)/360,1),y:(1-Math.log(Math.tan(Math.PI/4+latitude*Math.PI/360))/Math.PI)/2};}
export function searchDestination(location,width,height){
 coordinate(location.latitude,location.longitude);const point=mercator(location.latitude,location.longitude);let zoom=location.zoom??14;
 if(location.bounds?.length===4&&location.bounds.every(Number.isFinite)){
  const [west,y1,east,y2]=location.bounds,north=Math.min(limit,Math.max(y1,y2)),south=Math.max(-limit,Math.min(y1,y2));
  const dx=Math.abs(east-west)>=360?1:wrap(east-west,360)/360,dy=Math.abs(mercator(north,0).y-mercator(south,0).y);
  zoom=Math.min(16,Math.log2(Math.max(80,width-80)/(256*Math.max(dx,1e-8))),Math.log2(Math.max(80,height-80)/(256*Math.max(dy,1e-8))));
 }
 const cosLat=Math.cos(location.latitude*Math.PI/180),radius=256*2**zoom/(2*Math.PI*cosLat);
 return {...point,zoom,sphereZoom:Math.log2(radius/(.46*Math.max(1,Math.min(width,height))))};
}
export function geocoderLocations(features){
 return features.filter(f=>f.geometry?.type==='Point'&&f.geometry.coordinates?.length>=2).flatMap(f=>{
  const [longitude,latitude]=f.geometry.coordinates,p=f.properties||{};
  try{coordinate(latitude,longitude);}catch{return [];}
  const street=[p.housenumber,p.street].filter(Boolean).join(' '),name=p.name||street||p.city||p.state||p.country||'Location';
  const details=[street,p.city,p.state,p.country].filter(Boolean).filter((v,i,a)=>v!==name&&a.indexOf(v)===i).join(', ');
  const kind=p.osm_value||p.type,zoom=({country:4,state:6,county:8,city:11,town:12,village:13,street:15})[kind]??16;
  return [{latitude,longitude,name,details,zoom,bounds:p.extent||f.bbox}];
 });
}
export function setupSearch(onNavigate){
 const form=document.getElementById('location-search'),input=document.getElementById('location-query'),results=document.getElementById('search-results'),status=document.getElementById('search-status');let controller,generation=0,choices=[],lastQuery='';const cache=new Map();
 function clear(){choices=[];results.replaceChildren();results.hidden=true;}
 function select(location){onNavigate(location);clear();status.textContent=location.name||`${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;}
 input.addEventListener('input',()=>{generation++;controller?.abort();clear();status.textContent='';});
 input.addEventListener('keydown',event=>{if(event.key==='ArrowDown'&&choices.length){event.preventDefault();results.querySelector('button')?.focus();}if(event.key==='Escape'){controller?.abort();generation++;clear();status.textContent='';event.stopPropagation();}});
 form.addEventListener('submit',async event=>{
  event.preventDefault();const query=input.value.trim();if(!query)return;
  if(query===lastQuery&&choices.length){select(choices[0]);return;}
  controller?.abort();controller=new AbortController();const token=++generation;clear();status.textContent='';
  try{
   const point=parseCoordinates(query);if(point){select(point);return;}
   status.textContent='Searching…';let locations=cache.get(query.toLocaleLowerCase());
   if(!locations){const url=new URL(GEOCODER_URL);url.searchParams.set('q',query);url.searchParams.set('limit','5');url.searchParams.set('lang','en');const response=await fetch(url,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});if(!response.ok)throw Error('Address search is unavailable. Try again.');const data=await response.json();locations=geocoderLocations(data.features||[]);if(token!==generation)return;cache.set(query.toLocaleLowerCase(),locations);if(cache.size>32)cache.delete(cache.keys().next().value);}
   if(token!==generation)return;if(!locations.length){status.textContent='No locations found.';return;}if(locations.length===1){select(locations[0]);return;}
   choices=locations;lastQuery=query;status.textContent='Choose a result';results.hidden=false;
   for(const location of locations){const li=document.createElement('li'),button=document.createElement('button'),name=document.createElement('span'),detail=document.createElement('small');button.type='button';name.textContent=location.name;detail.textContent=location.details;button.append(name,detail);button.addEventListener('click',()=>select(location));button.addEventListener('keydown',event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const buttons=[...results.querySelectorAll('button')],i=buttons.indexOf(button);buttons[(i+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length].focus();}if(event.key==='Escape'){clear();input.focus();event.stopPropagation();}});li.append(button);results.append(li);}
  }catch(error){if(token!==generation||error.name==='AbortError')return;status.textContent=error.name==='TimeoutError'?'Search timed out. Try again.':error.message;}
 });
}
