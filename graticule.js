import {mapProject} from './map-overlay.js';
const radians=Math.PI/180;
const latitude=y=>Math.atan(Math.sinh(Math.PI*(1-2*y)))/radians;
const mercator=lat=>(1-Math.asinh(Math.tan(lat*radians))/Math.PI)/2;
const steps=[.00001,.00002,.00005,.0001,.0002,.0005,.001,.002,.005,.01,.02,.05,.1,.2,.5,1,2,5,10,15,30,45,90];
export function gridStep(pixelsPerDegree){return steps.find(step=>step*pixelsPerDegree>=110)??90;}
export function degreeLabel(value,axis,step){
 const decimals=Math.max(0,Math.ceil(-Math.log10(step)));
 const normalized=axis==='longitude'?((value+180)%360+360)%360-180:value;
 const suffix=Math.abs(normalized)<step*1e-5?'':axis==='longitude'?(normalized<0?'W':'E'):(normalized<0?'S':'N');
 return `${Math.abs(normalized).toFixed(decimals)}°${suffix}`;
}
export class Graticule{
 draw(base,{view,width,height,dpr,camera}){
  const signature=[base?.revision??-1,view.x,view.y,view.zoom,width,height,dpr,camera?.radius??0].join('/');
  if(signature===this.signature)return this.scene;
  this.signature=signature;
  const cssCamera=camera?{...camera,width,height,radius:camera.radius/dpr}:null;
  const centerLat=latitude(view.y),centerLon=view.x*360-180,cos=Math.max(.001,Math.cos(centerLat*radians));
  const scale=256*2**view.zoom;
  const latPixels=cssCamera?cssCamera.radius*radians:scale/360/cos;
  const lonPixels=cssCamera?cssCamera.radius*radians*cos:scale/360;
  const latStep=gridStep(latPixels),lonStep=gridStep(lonPixels);
  let south,north,west,east;
  if(cssCamera){
   const angle=Math.asin(Math.min(1,Math.hypot(width,height)/2/cssCamera.radius))/radians;
   south=Math.max(-89.999999,centerLat-angle-2*latStep);north=Math.min(89.999999,centerLat+angle+2*latStep);
   const span=Math.min(180,angle/Math.max(.001,Math.cos(Math.min(89.999,Math.abs(centerLat)+angle)*radians))+2*lonStep);
   west=centerLon-span;east=centerLon+span;
  }else{
   south=Math.max(-85.05112878,latitude(view.y+height/2/scale));north=Math.min(85.05112878,latitude(view.y-height/2/scale));
   west=centerLon-width/2/scale*360;east=centerLon+width/2/scale*360;
  }
  const z=Math.max(0,Math.floor(cssCamera?Math.log2(2*Math.PI*cssCamera.radius/256):view.zoom)),n=2**z;
  const tile={z,x:Math.floor(view.x*n),y:Math.floor(view.y*n),key:'graticule'};
  const segments=[],labels=[],boxes=(base?.labels??[]).map(l=>[l.point[0],l.point[1],(l.textWidth??l.name.length*l.size*.6)/2+8,l.size+6]);
  const project=(lon,lat)=>mapProject(view,width,height,cssCamera,{z:0,x:0,y:0},1,(lon+180)/360,mercator(lat));
  const local=(lon,lat)=>[((lon+180)/360)*n-tile.x,mercator(lat)*n-tile.y];
  function line(axis,value,from,to,step){
   const count=cssCamera?Math.max(16,Math.ceil((to-from)/1.5)):16;
   let previous=null,best=null,bestScore=Infinity,reachesInset=false;
   const samples=[],coordinate=axis==='latitude'?0:1,target=axis==='latitude'?42:28;
   const at=variable=>axis==='latitude'?project(variable,value):project(value,variable);
   const valid=screen=>{
    if(!screen)return false;
    const [x,y]=screen;
    // Skip labels that would overlap the legend instead of pushing them inward.
    return x>=35&&x<=width-35&&y>=22&&y<=height-22&&!(x<140&&y<300)
     &&(!cssCamera||Math.hypot(x-width/2,y-height/2)<=cssCamera.radius-18);
   };
   const consider=screen=>{
    if(!valid(screen))return;
    const score=Math.abs(screen[coordinate]-target);
    if(score<bestScore){bestScore=score;best=screen;}
   };
   for(let i=0;i<=count;i++){
    const variable=from+(to-from)*i/count,lon=axis==='latitude'?variable:value,lat=axis==='latitude'?value:variable;
    const point=local(lon,lat);
    if(previous)segments.push(...previous,...point,.45,-100,1,.4);
    previous=point;samples.push({variable,screen:at(variable)});
   }
   // Solve intersections with fixed viewport insets. Labels no longer snap
   // between tessellation vertices as the camera moves or the mesh LOD changes.
   for(let i=1;i<samples.length;i++){
    const a=samples[i-1],b=samples[i];
    if(!a.screen||!b.screen)continue;
    const da=a.screen[coordinate]-target,db=b.screen[coordinate]-target;
    if(da*db>0)continue;
    reachesInset=true;
    let lo=a.variable,hi=b.variable;
    for(let iteration=0;iteration<24;iteration++){
     const mid=(lo+hi)/2,screen=at(mid);if(!screen)break;
     if((screen[coordinate]-target)*da>0)lo=mid;else hi=mid;
    }
    consider(at((lo+hi)/2));
   }
   // A globe wholly inside the viewport may never reach an inset. Find the
   // continuous nearest point on its visible arc rather than a sampled vertex.
   if(!best&&reachesInset)return;
   if(!best){
    let nearest=-1;
    for(let i=0;i<samples.length;i++){
     const before=bestScore;consider(samples[i].screen);
     if(bestScore<before){nearest=i;}
    }
    if(nearest>=0){
     let lo=samples[Math.max(0,nearest-1)].variable,hi=samples[Math.min(count,nearest+1)].variable;
     const cost=variable=>{const point=at(variable);return valid(point)?Math.abs(point[coordinate]-target):Infinity;};
     for(let i=0;i<28;i++){const a=lo+(hi-lo)/3,b=hi-(hi-lo)/3;if(cost(a)<cost(b))hi=b;else lo=a;}
     consider(at((lo+hi)/2));
    }
   }
   if(!best)return;
   const text=degreeLabel(value,axis,step),half=text.length*3.2+6;
   if(boxes.some(([x,y,w,h])=>Math.abs(x-best[0])<w+half&&Math.abs(y-best[1])<h+10))return;
   boxes.push([best[0],best[1],half,10]);
   labels.push({name:text,text,point:best,size:10,weight:400,font:'400 10px "Atlas Plex Mono", monospace',spacing:'0px',textWidth:text.length*6});
  }
  for(let lat=Math.ceil(south/latStep)*latStep,i=0;lat<=north+latStep*1e-6&&i<100;lat+=latStep,i++)line('latitude',lat,west,east,latStep);
  for(let lon=Math.ceil(west/lonStep)*lonStep,i=0;lon<=east+lonStep*1e-6&&i<100;lon+=lonStep,i++)line('longitude',lon,south,north,lonStep);
  const entry={geometry:{segments:new Float32Array(segments)}};
  this.scene={gpu:true,revision:(this.revision=(this.revision??0)+1),fontRevision:base?.fontRevision??0,view:{...view},width,height,dpr,camera:cssCamera,zoom:base?.zoom??view.zoom,tiles:[...(base?.tiles??[]),{tile,entry}],entries:new Set([...(base?.entries??[]),entry]),labels:[...(base?.labels??[]),...labels]};
  return this.scene;
 }
}
