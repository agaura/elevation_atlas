export const BODIES = {
 earth: {label:'Earth',radius:6378137,min:-12000,max:9000},
 mars: {label:'Mars',radius:3396190,min:-12000,max:24000,meshOffset:8201,maxzoom:11,terrain:'https://marshub.s3.amazonaws.com/mars_v14/',collection:'mro_ctx_controlled_usgs_dtms',asset:'geoid_adjusted_dem',rasterRadius:3396190},
 moon: {label:'Moon',radius:1737400,min:-12000,max:12000,maxzoom:11,terrain:'https://marshub.s3.amazonaws.com/moon_v14/',collection:'kaguya_terrain_camera_usgs_dtms_v2_equi',asset:'dtm',rasterRadius:1737400}
};
export function latitudeAt(v){return Math.atan(Math.sinh(Math.PI*(1-2*v)))*180/Math.PI;}
export function mercatorY(latitude){return (1-Math.asinh(Math.tan(latitude*Math.PI/180))/Math.PI)/2;}
export function meshBounds(z,x,y){const width=180/2**z;return {west:-180+x*width,east:-180+(x+1)*width,south:-90+y*width,north:-90+(y+1)*width};}
export function meshAvailable(manifest,z,x,y){return manifest.available?.[z]?.some(r=>x>=r.startX&&x<=r.endX&&y>=r.startY&&y<=r.endY)??false;}
// Keep the world preview cheap; visible terrain requests two finer mesh levels.
// This quarters nominal triangle spacing without enlarging GPU height textures.
export function planetaryMeshZoom(tileZoom, manifest) {
 return Math.min(tileZoom === 0 ? 0 : tileZoom + 2, manifest.available.length - 1);
}
export function availableMeshAddress(manifest, z, x, y) {
 while(z > 0 && !meshAvailable(manifest,z,x,y)) {
  z--; x=Math.floor(x/2); y=Math.floor(y/2);
 }
 return {z,x,y};
}
export function decodeTerrainMesh(bytes){
 const view=new DataView(bytes);if(bytes.byteLength<92)throw Error('Incomplete planetary terrain header');
 const minimum=view.getFloat32(24,true),maximum=view.getFloat32(28,true),count=view.getUint32(88,true);
 if(!Number.isFinite(minimum)||!Number.isFinite(maximum)||minimum>maximum||count<3||count>1e6||bytes.byteLength<92+count*6+4)throw Error('Invalid planetary terrain');
 const positions=new Float32Array(count*3);
 for(let axis=0;axis<3;axis++){
  let current=0;for(let i=0;i<count;i++){
   const code=view.getUint16(92+axis*count*2+i*2,true);current+=(code>>>1)^-(code&1);
   if(current<0||current>32767)throw Error('Invalid terrain vertex');
   positions[i*3+axis]=axis===2?minimum+(maximum-minimum)*current/32767:current/32767;
  }
 }
 const indexBytes=count>65536?4:2;
 let offset=92+count*6;offset=Math.ceil(offset/indexBytes)*indexBytes;
 const triangles=view.getUint32(offset,true);offset+=4;
 if(triangles>2e6||offset+triangles*3*indexBytes>bytes.byteLength)throw Error('Invalid terrain triangles');
 const indices=new Uint32Array(triangles*3);let highest=0;
 for(let i=0;i<indices.length;i++){
  const code=indexBytes===2?view.getUint16(offset+i*2,true):view.getUint32(offset+i*4,true);
  const index=highest-code;if(index<0||index>=count)throw Error('Invalid terrain index');indices[i]=index;if(code===0)highest++;
 }
 return {positions,indices,minimum,maximum};
}
export function triangleHeight(mesh,ia,ib,ic,u,v){
 const p=mesh.positions,a=ia*3,b=ib*3,c=ic*3;
 const denominator=(p[b+1]-p[c+1])*(p[a]-p[c])+(p[c]-p[b])*(p[a+1]-p[c+1]);
 if(Math.abs(denominator)<1e-15)return NaN;
 const wa=((p[b+1]-p[c+1])*(u-p[c])+(p[c]-p[b])*(v-p[c+1]))/denominator;
 const wb=((p[c+1]-p[a+1])*(u-p[c])+(p[a]-p[c])*(v-p[c+1]))/denominator,wc=1-wa-wb;
 return Math.min(wa,wb,wc)>=-1e-6?wa*p[a+2]+wb*p[b+2]+wc*p[c+2]:NaN;
}
export function meshHeight(mesh,u,v){for(let i=0;i<mesh.indices.length;i+=3){const h=triangleHeight(mesh,...mesh.indices.subarray(i,i+3),u,v);if(Number.isFinite(h))return h;}return NaN;}
// Rasterize geographic triangles at the actual Mercator output sample centers.
// Barycentric interpolation uses geographic coordinates, not a warped triangle.
export function rasterizeMesh(mesh,bounds,tile,size,values){
 const n=2**tile.z,x=((tile.x%n)+n)%n,west=x/n*360-180,east=(x+1)/n*360-180;
 const longitudes=Float64Array.from({length:size},(_,i)=>west+(east-west)*(i+.5)/size);
 const latitudes=Float64Array.from({length:size},(_,i)=>latitudeAt((tile.y+(i+.5)/size)/n));
 const p=mesh.positions;
 const pixelX=u=>(bounds.west+(bounds.east-bounds.west)*u-west)/(east-west)*size-.5;
 const pixelY=v=>(mercatorY(bounds.south+(bounds.north-bounds.south)*v)*n-tile.y)*size-.5;
 for(let i=0;i<mesh.indices.length;i+=3){
  const a=mesh.indices[i],b=mesh.indices[i+1],c=mesh.indices[i+2];
  const xs=[p[a*3],p[b*3],p[c*3]].map(pixelX),ys=[p[a*3+1],p[b*3+1],p[c*3+1]].map(v=>pixelY(Math.max(1e-8,Math.min(1-1e-8,v))));
  const left=Math.max(0,Math.ceil(Math.min(...xs)-1e-5)),right=Math.min(size-1,Math.floor(Math.max(...xs)+1e-5));
  const top=Math.max(0,Math.ceil(Math.min(...ys)-1e-5)),bottom=Math.min(size-1,Math.floor(Math.max(...ys)+1e-5));
  const ia=a*3,ib=b*3,ic=c*3;
  const denominator=(p[ib+1]-p[ic+1])*(p[ia]-p[ic])+(p[ic]-p[ib])*(p[ia+1]-p[ic+1]);
  if(Math.abs(denominator)<1e-15)continue;
  const au=(p[ib+1]-p[ic+1])/denominator,av=(p[ic]-p[ib])/denominator,ac=-au*p[ic]-av*p[ic+1];
  const bu=(p[ic+1]-p[ia+1])/denominator,bv=(p[ia]-p[ic])/denominator,bc=-bu*p[ic]-bv*p[ic+1];
  const du=(east-west)/size/(bounds.east-bounds.west),ua=(longitudes[left]-bounds.west)/(bounds.east-bounds.west);
  for(let row=top;row<=bottom;row++){
   const v=(latitudes[row]-bounds.south)/(bounds.north-bounds.south);
   let wa=au*ua+av*v+ac,wb=bu*ua+bv*v+bc;
   for(let col=left;col<=right;col++,wa+=au*du,wb+=bu*du){
    const wc=1-wa-wb;
    if(Math.min(wa,wb,wc)>=-1e-6)values[row*size+col]=wa*p[ia+2]+wb*p[ib+2]+wc*p[ic+2];
   }
  }
 }
}

// Geographic meshes stretch vertically when reprojected into Mercator. Refine
// the largest projected cells first, rather than loading a uniformly finer globe.
export function planetaryMeshCover(tile,size,manifest,{budget=192,maxExtraLevels=3}={}){
 const n=2**tile.z,x=((tile.x%n)+n)%n;
 const target={west:x/n*360-180,east:(x+1)/n*360-180,north:latitudeAt(tile.y/n),south:latitudeAt((tile.y+1)/n)};
 const base=planetaryMeshZoom(tile.z,manifest),count=2**base;
 const x0=Math.max(0,Math.floor((target.west+180)/180*count)),x1=Math.min(2*count-1,Math.ceil((target.east+180)/180*count)-1);
 const y0=Math.max(0,Math.floor((target.south+90)/180*count)),y1=Math.min(count-1,Math.ceil((target.north+90)/180*count)-1);
 const key=a=>`${a.z}/${a.x}/${a.y}`,cells=new Map(),processed=new Set();
 for(let y=y0;y<=y1;y++)for(let xx=x0;xx<=x1;xx++){
  const address=availableMeshAddress(manifest,base,xx,y);cells.set(key(address),address);
 }
 // The low-cost root is only a preview; visible tiles supply the detail.
 if(tile.z===0)return [...cells.values()];
 const intersects=b=>b.west<target.east&&b.east>target.west&&b.south<target.north&&b.north>target.south;
 const projectedHeight=address=>{
  const b=meshBounds(address.z,address.x,address.y),north=Math.min(b.north,target.north),south=Math.max(b.south,target.south);
  return (mercatorY(south)-mercatorY(north))*n*size;
 };
 while(true){
  const candidate=[...cells.values()].filter(a=>!processed.has(key(a))&&a.z<Math.min(base+maxExtraLevels,manifest.available.length-1))
   .map(address=>({address,height:projectedHeight(address)})).filter(item=>item.height>96)
   .sort((a,b)=>b.height-a.height||a.address.y-b.address.y||a.address.x-b.address.x)[0];
  if(!candidate)break;
  // Refine a complete latitude row together. Spending the budget on just
  // part of a row would introduce arbitrary vertical strips of different LOD.
  const address=candidate.address;
  const row=[...cells.values()].filter(a=>a.z===address.z&&a.y===address.y);
  const next=new Map(cells);
  for(const parent of row){
   processed.add(key(parent));next.delete(key(parent));
   for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
    const z=parent.z+1,x=parent.x*2+dx,y=parent.y*2+dy;
    if(!intersects(meshBounds(z,x,y)))continue;
    const child=availableMeshAddress(manifest,z,x,y);next.set(key(child),child);
   }
  }
  if(next.size<=Math.max(budget,cells.size)){cells.clear();for(const [id,child] of next)cells.set(id,child);}
 }
 return [...cells.values()].sort((a,b)=>a.z-b.z||a.y-b.y||a.x-b.x);
}
