import {wrap} from './terrain.js';
// Keep Mercator camera coordinates finite while centering either pole to
// substantially less than a device pixel at ordinary globe scales.
export const SPHERE_LATITUDE_LIMIT = Math.PI / 2 - 1e-8;
export function sphereYAtLatitude(latitude) {
 const lat=Math.max(-SPHERE_LATITUDE_LIMIT,Math.min(SPHERE_LATITUDE_LIMIT,latitude));
 return .5-Math.asinh(Math.tan(lat))/(2*Math.PI);
}
const northY=sphereYAtLatitude(SPHERE_LATITUDE_LIMIT);
export function boundedSphereY(y){return Math.max(northY,Math.min(1-northY,y));}
export function panSphere(view,dx,dy,radius){
 const latitude=Math.atan(Math.sinh(Math.PI*(1-2*view.y)))+dy/radius;
 return {x:wrap(view.x-dx/(2*Math.PI*radius),1),y:sphereYAtLatitude(latitude)};
}
export function sphereCamera(view,width,height,dpr=1,zoom=0){
 const lon=(view.x-.5)*2*Math.PI,lat=Math.atan(Math.sinh(Math.PI*(1-2*view.y))),cl=Math.cos(lat),sl=Math.sin(lat),co=Math.cos(lon),so=Math.sin(lon);
 return {right:[co,0,-so],up:[-sl*so,cl,-sl*co],front:[cl*so,sl,cl*co],center:[wrap(view.x,1),view.y],width:width*dpr,height:height*dpr,radius:Math.min(width,height)*.46*dpr*2**zoom};
}
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
export function sphereTiles(camera,maxzoom=18,tileSize=512){
 const out=[];function visit(z,x,y){const n=2**z,lon=(x+.5)/n*2*Math.PI-Math.PI,north=Math.atan(Math.sinh(Math.PI*(1-2*y/n))),south=Math.atan(Math.sinh(Math.PI*(1-2*(y+1)/n))),lat=(north+south)/2;
 const point=[Math.cos(lat)*Math.sin(lon),Math.sin(lat),Math.cos(lat)*Math.cos(lon)];
 // This spherical-cap bound encloses every point of the Mercator tile.
 const angle=Math.min(Math.PI,Math.PI/n+(north-south)/2),bound=camera.radius*Math.min(2,2*Math.sin(angle/2));
 if(angle<Math.PI/2&&dot(point,camera.front)<-Math.sin(angle))return;
 const px=camera.width/2+camera.radius*dot(point,camera.right),py=camera.height/2-camera.radius*dot(point,camera.up);
 if(px+bound<0||py+bound<0||px-bound>camera.width||py-bound>camera.height)return;
 const closest=south<=0&&north>=0?0:Math.min(Math.abs(south),Math.abs(north));
 if(z<maxzoom&&2*Math.PI*camera.radius*Math.cos(closest)/(tileSize*n)>1){for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)visit(z+1,x*2+dx,y*2+dy);}
 else out.push({z,x,y,key:`${z}/${wrap(x,n)}/${y}`,priority:dot(point,camera.front)});
 }visit(0,0,0);return out.sort((a,b)=>b.priority-a.priority);
}
// Inverse orthographic ray, using CSS pixels relative to the viewport center.
export function spherePointAt(view,width,height,zoom,x,y){const c=sphereCamera(view,width,height,1,zoom),px=x/c.radius,py=y/c.radius,r2=px*px+py*py;if(r2>=1)return null;return c.front.map((v,i)=>v*Math.sqrt(1-r2)+c.right[i]*px-c.up[i]*py);}
export function zoomSphereAt(view,width,height,oldZoom,newZoom,x,y){
 const point=spherePointAt(view,width,height,oldZoom,x,y);if(!point)return {x:view.x,y:view.y};
 const radius=Math.min(width,height)*.46*2**newZoom,a=x/radius,b=-y/radius,cp=Math.hypot(point[0],point[2]);
 if(a*a+b*b>=1||Math.abs(a)>cp||cp<1e-12)return {x:view.x,y:view.y};
 const lonP=Math.atan2(point[0],point[2]),delta=Math.asin(Math.max(-1,Math.min(1,a/cp))),old=sphereCamera(view,width,height).front,candidates=[];
 for(const d of [delta,Math.PI-delta]){const B=cp*Math.cos(d),r=Math.hypot(point[1],B),lat=Math.atan2(point[1],B)-Math.asin(Math.max(-1,Math.min(1,b/r)));if(Math.abs(lat)>SPHERE_LATITUDE_LIMIT)continue;const lon=lonP-d,front=[Math.cos(lat)*Math.sin(lon),Math.sin(lat),Math.cos(lat)*Math.cos(lon)];candidates.push({x:wrap(lon/(2*Math.PI)+.5,1),y:sphereYAtLatitude(lat),score:dot(front,old)});}
 candidates.sort((a,b)=>b.score-a.score);return candidates[0]??{x:view.x,y:view.y};
}

// Equatorial texel spacing at the globe center: 2πR / native world width.
// Use CSS radius, so the zoom ceiling is independent of DPR and latitude.
export function maximumSphereZoom(width,height,mapZoom){
 return Math.log2(256*2**mapZoom/(2*Math.PI*.46*Math.max(1,Math.min(width,height))));
}

// Match metres per CSS pixel at the view center across projections.
export function sphereZoomFromMapZoom(mapZoom,y,width,height){
 const cosLatitude=1/Math.cosh(Math.PI*(1-2*y));
 const baseRadius=.46*Math.max(1,Math.min(width,height));
 return mapZoom+Math.log2(256/(2*Math.PI*cosLatitude*baseRadius));
}
export function mapZoomFromSphereZoom(sphereZoom,y,width,height){
 return sphereZoom-sphereZoomFromMapZoom(0,y,width,height);
}
