// GeoJSON polygon operations, including holes and antimeridian-crossing rings.
export const wrapLongitude=x=>((x+180)%360+360)%360-180;
export const administrativeMaskLevel=zoom=>zoom>=9?2:zoom>=5?1:0;
export function ringContains(ring,longitude,latitude){
 let inside=false;
 let previous=ring[0][0]+wrapLongitude(longitude-ring[0][0]);
 const points=ring.map(([x,y],i)=>{const u=i?previous+wrapLongitude(x-previous):x;previous=u;return [u,y];});
 const reference=points[0][0],x=reference+wrapLongitude(longitude-reference);
 for(let i=0,j=points.length-1;i<points.length;j=i++){
  const a=points[i],b=points[j];
  if((a[1]>latitude)!==(b[1]>latitude)&&x<(b[0]-a[0])*(latitude-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }
 return inside;
}
export function geometryContains(geometry,longitude,latitude){
 const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[];
 return polygons.some(rings=>rings[0]?.length&&ringContains(rings[0],longitude,latitude)&&!rings.slice(1).some(ring=>ringContains(ring,longitude,latitude)));
}
export function prepareRegions(collection){
 return (collection.features??[]).filter(f=>['Polygon','MultiPolygon'].includes(f.geometry?.type)).map(feature=>{
  const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
  const boxes=polygons.map(rings=>{let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;for(const [x,y] of rings[0]){west=Math.min(west,x);east=Math.max(east,x);south=Math.min(south,y);north=Math.max(north,y);}return {west,east,south,north};});
  return {feature,boxes};
 });
}
export function findRegion(regions,longitude,latitude){
 for(const {feature,boxes} of regions){
  const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
  for(let i=0;i<boxes.length;i++){
   const b=boxes[i];if(latitude<b.south||latitude>b.north||b.east-b.west<=180&&(longitude<b.west||longitude>b.east))continue;
   const rings=polygons[i];
   if(ringContains(rings[0],longitude,latitude)&&!rings.slice(1).some(ring=>ringContains(ring,longitude,latitude)))return feature;
  }
 }
 return null;
}
export function maskRings(geometry,longitude){
 const reference=(longitude+180)/360,polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
 const rings=[];let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
 for(const polygon of polygons){
  let outerReference=reference;
  for(const ring of polygon){
   let previous=outerReference;
   const points=ring.map(([lon,lat],i)=>{
    let x=(lon+180)/360;x+=Math.round((i?previous:outerReference)-x);previous=x;
    const y=(1-Math.asinh(Math.tan(Math.max(-85.05112878,Math.min(85.05112878,lat))*Math.PI/180))/Math.PI)/2;
    left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);return [x,y];
   });
   if(ring===polygon[0]&&points.length)outerReference=points[0][0];rings.push(points);
  }
 }
 left=Math.max(left,reference-.5);right=Math.min(right,reference+.5);
 return {rings,reference,bounds:[left,top,Math.max(1e-9,right-left),Math.max(1e-9,bottom-top)]};
}
