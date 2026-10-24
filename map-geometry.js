// Immutable vector data prepared once in the tile worker, shared by GPU strokes
// and the much smaller CPU label-placement/proximity queries.
export const ROAD_STYLES={motorway:[.65,4],trunk:[.55,5],primary:[.475,6],secondary:[.4,8],tertiary:[.35,9],minor:[.3,11],service:[.3,13],track:[.3,14],path:[.3,15],rail:[.275,9],transit:[.3,13]};
export function roadStyle(kind){return ROAD_STYLES[kind]||[.3,12];}
export function buildMapGeometry(layers,z){
 const data=[],grid=new Map(),groups=new Map(),gridBounds=[Infinity,Infinity,-Infinity,-Infinity];let stateBorders=false;
 // Bound angular curvature even on overview tiles. At detailed zooms the MVT
 // source already contains most vertices; the extra pieces are usually short.
 const step=Math.min(1/32,2**z/1024);
 for(const layer of layers){
  if(layer.name!=='transportation'&&layer.name!=='boundary')continue;
  for(const feature of layer.features){
   const p=feature.properties;let width,minzoom,channel,strength;
   if(layer.name==='transportation'){
    if(feature.type!==2)continue;[width,minzoom]=roadStyle(p.class);channel=0;strength=1;
   }else{
    const level=Number(p.admin_level);if(Number(p.maritime)===1||!(level<=6))continue;
    width=level<=2?.6:level<=4?.4:.275;minzoom=level<=2?0:level<=4?5:9;channel=1;strength=level<=2?1:level<=4?158/255:107/255;
    if(level>2&&level<=4)stateBorders=true;
   }
   const groupKey=`${channel}/${minzoom}`;groups.set(groupKey,(groups.get(groupKey)||0)+feature.paths.length);
   for(const path of feature.paths)for(let i=2;i<path.length;i+=2){
    const ax=path[i-2]/layer.extent,ay=path[i-1]/layer.extent,bx=path[i]/layer.extent,by=path[i+1]/layer.extent;
    const pieces=Math.max(1,Math.ceil(Math.max(Math.abs(bx-ax),Math.abs(by-ay))/step));
    for(let j=0;j<pieces;j++){
     const t=j/pieces,u=(j+1)/pieces,a=ax+(bx-ax)*t,b=ay+(by-ay)*t,c=ax+(bx-ax)*u,d=ay+(by-ay)*u,index=data.length/8;
     data.push(a,b,c,d,width,minzoom,channel,strength);
     if(channel===0)for(let y=Math.floor(Math.min(b,d)*16);y<=Math.floor(Math.max(b,d)*16);y++)for(let x=Math.floor(Math.min(a,c)*16);x<=Math.floor(Math.max(a,c)*16);x++){
      gridBounds[0]=Math.min(gridBounds[0],x);gridBounds[1]=Math.min(gridBounds[1],y);gridBounds[2]=Math.max(gridBounds[2],x);gridBounds[3]=Math.max(gridBounds[3],y);const key=`${x}/${y}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(index);
     }
    }
   }
  }
 }
 return {segments:new Float32Array(data),grid:new Map([...grid].map(([key,indices])=>[key,new Uint32Array(indices)])),groups:[...groups],gridBounds,stateBorders};
}
