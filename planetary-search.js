import {loadPlanetaryNames} from './planetary-labels.js';
const normalize=text=>text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const types={AA:'Crater',SF:'Satellite crater',MO:'Mountain',ME:'Mare',OC:'Oceanus',VA:'Valley',RI:'Rille',RU:'Escarpment',PM:'Plain',PL:'Plateau',TE:'Terrain',AL:'Albedo feature',FO:'Fossa',TH:'Dome',PA:'Patera'};
export function matchPlanetaryFeatures(features,query,body){
 const key=normalize(query),words=key.split(' ');if(!key)return [];
 const matches=features.flatMap(feature=>{
  const name=normalize(feature.name),tokens=name.split(' ');
  const rank=name===key?0:name.startsWith(key)?1:words.every(word=>tokens.some(token=>token.startsWith(word)))?2:name.includes(key)?3:words.every(word=>name.includes(word))?4:Infinity;
  return Number.isFinite(rank)?[{feature,rank}]:[];
 }).sort((a,b)=>a.rank-b.rank||b.feature.diameterKm-a.feature.diameterKm||a.feature.name.localeCompare(b.feature.name));
 const selected=matches[0]?.rank===0?matches.filter(match=>match.rank===0):matches.slice(0,5);
 return selected.map(({feature})=>({
  name:feature.name,latitude:Math.atan(Math.sinh(Math.PI*(1-2*feature.y)))*180/Math.PI,
  longitude:feature.x*360-180,diameterKm:feature.diameterKm,
  details:`${body==='mars'?'Mars':'Moon'} · ${types[feature.typeCode]??'Geographic feature'}${feature.diameterKm?` · ${feature.diameterKm.toLocaleString()} km`:''}`
 }));
}
export async function searchPlanetaryFeatures(body,query){
 return matchPlanetaryFeatures(await loadPlanetaryNames(body),query,body);
}
