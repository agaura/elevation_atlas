import {wrap} from './terrain.js';
import {spherePointAt} from './sphere.js';

// CSS-space pointer offsets from the center; elevation sampling uses native DEMs.
export function probePosition(view,width,height,sphereZoom,x,y,sphere=false){
 let u,v;
 if(sphere){
  const point=spherePointAt(view,width,height,sphereZoom,x,y);if(!point)return null;
  const lat=Math.asin(Math.max(-1,Math.min(1,point[1])));
  u=wrap(Math.atan2(point[0],point[2])/(2*Math.PI)+.5,1);
  v=(1-Math.log(Math.tan(Math.PI/4+lat/2))/Math.PI)/2;
 }else{const scale=256*2**view.zoom;u=wrap(view.x+x/scale,1);v=view.y+y/scale;}
 return v>=0&&v<1?{x:u,y:v}:null;
}

export function sampleProbe(cache,point,maxzoom=18){
 if(!point)return null;
 for(let z=maxzoom;z>=0;z--){
  const n=2**z,tx=point.x*n,ty=point.y*n;
  const entry=cache.get(`${z}/${Math.floor(tx)}/${Math.floor(ty)}`);
  if(entry?.state!=='ready'||!entry.values)continue;
  const {size,values}=entry,px=(tx-Math.floor(tx))*size-.5,py=(ty-Math.floor(ty))*size-.5;
  const index=(x,y)=>(Math.max(0,Math.min(size-1,y))*size+Math.max(0,Math.min(size-1,x)))*2;
  const nearest=index(Math.floor(px+.5),Math.floor(py+.5)),height=values[nearest],kind=values[nearest+1];
  if(!Number.isFinite(height)||height< -40000||height>40000)return {elevation:null};
  const read=(x,y)=>{const i=index(x,y),v=values[i];return Number.isFinite(v)&&v>=-40000&&v<=40000&&Math.sign(values[i+1])===Math.sign(kind)?v:height;};
  const x=Math.floor(px),y=Math.floor(py),fx=px-x,fy=py-y;
  const top=read(x,y)*(1-fx)+read(x+1,y)*fx,bottom=read(x,y+1)*(1-fx)+read(x+1,y+1)*fx;
  return {elevation:top*(1-fy)+bottom*fy,water:kind<0};
 }
 return null;
}
