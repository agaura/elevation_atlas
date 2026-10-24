const shader=`struct Out{@builtin(position) position:vec4f}
@vertex fn full(@builtin(vertex_index)i:u32)->Out{let a=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));var o:Out;o.position=vec4f(a[i],0,1);return o;}
struct Camera{right:vec4f,up:vec4f,front:vec4f,view:vec4f,lookup:vec4f,origin:vec4f}
@group(0) @binding(0) var atlas:texture_2d_array<f32>;
@group(0) @binding(1) var<storage,read> pages:array<vec4u>;
@group(0) @binding(2) var<uniform> camera:Camera;
fn hash(x:u32,y:u32,z:u32)->u32{return (x*73856093u)^(y*19349663u)^(z*83492791u);}
fn layerAt(x:u32,y:u32,z:u32)->i32{let mask=u32(camera.lookup.y);var slot=hash(x,y,z)&mask;for(var i=0u;i<=mask;i++){let p=pages[slot];if(p.w==0u){return -1;}if(all(p.xyz==vec3u(x,y,z))){return i32(p.w)-1;}slot=(slot+1u)&mask;}return -1;}
fn valid(v:vec4f,c:vec4f)->f32{if(!(v.x>=-40000&&v.x<=40000)||sign(v.y)!=sign(c.y)){return c.x;}return v.x;}
// GPU atan2 implementations can have absolute error near zero. Preserve tiny
// camera-relative angles with a local series instead of subtractive trig paths.
fn localAngle(y:f32,x:f32)->f32{
 if(x>0.&&abs(y)<.01*x){let t=y/x;let t2=t*t;return t*(1.-t2/3.+t2*t2/5.);}
 return atan2(y,x);
}
@fragment fn height(o:Out)->@location(0) vec2f{
 let xy=(o.position.xy-camera.view.xy*.5)/camera.view.z;let r2=dot(xy,xy);if(r2>1.){return vec2f(-1e30,1);}
 // Work relative to the camera's tile origin. Global float32 Mercator UVs
 // lose several device pixels of precision at native-resolution zoom levels.
 let rayX=xy.x;let rayY=-xy.y;let rayZ=sqrt(max(0.,1.-r2));
 let cosLat=camera.up.y;let sinLat=camera.front.y;
 let q=rayZ*cosLat-rayY*sinLat;let horizontal=sqrt(q*q+rayX*rayX);
 var correction=horizontal-q;if(q>0.){correction=rayX*rayX/max(horizontal+q,.00000001);}
 let deltaLat=localAngle(rayY-sinLat*correction,rayZ+cosLat*correction);
 let lat0=atan2(sinLat,cosLat);let lat=lat0+deltaLat;
 if(abs(lat)>1.48442223){return vec2f(-1e30,1);}
 let deltaU=localAngle(rayX,q)/6.28318530718;
 var deltaV=0.;
 if(abs(deltaLat)<.001){
  let tangent=sinLat/cosLat;
  deltaV=-deltaLat/(6.28318530718*cosLat)*(1.+.5*tangent*deltaLat+(1.+2.*tangent*tangent)*deltaLat*deltaLat/6.);
 }else{
  let centerV=(camera.origin.y+camera.origin.w)/exp2(camera.lookup.x);
  deltaV=(1.-log(tan(.78539816339+lat*.5))/3.14159265359)*.5-centerV;
 }
 var layer=-1;var uv=vec2f(0);var level=0.;
 for(var z=i32(camera.lookup.x);z>=0;z--){
  let shift=u32(camera.lookup.x)-u32(z);let divisor=1u<<shift;
  let n=f32(1u<<u32(z));let relative=1./f32(divisor);
  let origin=vec2u(camera.origin.xy);
  let base=origin>>vec2u(shift);
  let remainder=origin&vec2u(divisor-1u);
  let local=(vec2f(remainder)+camera.origin.zw)*relative+vec2f(deltaU,deltaV)*n;
  let address=vec2i(base)+vec2i(floor(local));let count=i32(n);
  if(address.y<0||address.y>=count){continue;}
  let tile=vec2u(u32(((address.x%count)+count)%count),u32(address.y));
  layer=layerAt(tile.x,tile.y,u32(z));
  if(layer>=0){uv=fract(local);level=f32(z);break;}
 }
 if(layer<0){return vec2f(-1e30,1);}
 let dims=vec2i(textureDimensions(atlas));let p=uv*vec2f(dims)-.5;let base=vec2i(floor(p));let f=fract(p);let limit=dims-1;
 let center=textureLoad(atlas,clamp(vec2i(floor(p+.5)),vec2i(0),limit),layer,0);
 if(!(center.x>=-40000&&center.x<=40000)||(camera.view.w>.5&&center.y<0.)){return vec2f(-1e30,1);}
 let a=valid(textureLoad(atlas,clamp(base,vec2i(0),limit),layer,0),center);let b=valid(textureLoad(atlas,clamp(base+vec2i(1,0),vec2i(0),limit),layer,0),center);
 let c=valid(textureLoad(atlas,clamp(base+vec2i(0,1),vec2i(0),limit),layer,0),center);let d=valid(textureLoad(atlas,clamp(base+vec2i(1,1),vec2i(0),limit),layer,0),center);
 let footprint=6.28318530718*camera.view.z*cos(lat)/(f32(dims.x)*exp2(level))*abs(center.y);
 return vec2f(mix(mix(a,b,f.x),mix(c,d,f.x),f.y),select(max(1.,footprint),0.,level==0.&&camera.lookup.z>0.));
}`;
const shader8=shader.replace('origin:vec4f}', 'origin:vec4f,quant:vec4f}').replaceAll('textureLoad(atlas,','sourceLoad(atlas,').replaceAll('return vec2f(-1e30,1);','return vec2f(0.);').replace('return vec2f(mix(', 'return packHeight(vec2f(mix(').replace('camera.lookup.z>0.));','camera.lookup.z>0.)));')+`
fn sourceLoad(tex:texture_2d_array<f32>,xy:vec2i,layer:i32,level:i32)->vec4f{
 let value=textureLoad(tex,xy,layer,level);let code=u32(round(value.g*255.));if(code==0u){return vec4f(-1e30,0.,0.,0.);}
 let exponent=(code&127u)-1u;var spacing=1.;if(exponent>0u){spacing=exp2(f32(exponent));}let kind=spacing*select(1.,-1.,(code&128u)!=0u);return vec4f(mix(camera.quant.x,camera.quant.y,value.r),kind,0.,0.);
}
fn packHeight(value:vec2f)->vec2f{
 let q=round(clamp((value.x-camera.quant.x)/max(camera.quant.y-camera.quant.x,.00001),0.,1.)*255.)/255.;var metadata=1.;if(value.y>0.){metadata=2.;if(value.y>1.){metadata=min(255.,2.+round(log2(value.y)*8.));}}return vec2f(q,metadata/255.);
}`;
export async function createSpherePass(device,{highPrecision=true}={}){
 const format=highPrecision?'rg32float':'rg8unorm';
 const layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float',viewDimension:'2d-array'}},{binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},{binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},...Array.from({length:7},(_,i)=>({binding:i+3,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float',viewDimension:'2d-array'}}))]});
 const pageCount=8;
 let code=highPrecision?shader:shader8;
 code=code.replace('@group(0) @binding(0) var atlas:texture_2d_array<f32>;',Array.from({length:pageCount},(_,i)=>`@group(0) @binding(${i===0?0:i+2}) var atlas${i}:texture_2d_array<f32>;`).join('\n'));
 code=code.replaceAll('textureDimensions(atlas)','textureDimensions(atlas0)').replaceAll(highPrecision?'textureLoad(atlas,':'sourceLoad(atlas,','atlasLoad(');
 code+=`\nfn atlasLoad(xy:vec2i,layer:i32,level:i32)->vec4f{let local=layer/8;switch(layer%8){${Array.from({length:pageCount},(_,i)=>`case ${i}:{return ${highPrecision?'textureLoad':'sourceLoad'}(atlas${i},xy,local,level);}`).join('')}default:{return vec4f(0.);}}}`;
 const module=device.createShaderModule({code});const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(e=>e.message).join('\n'));
 const pipeline=await device.createRenderPipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[layout]}),vertex:{module,entryPoint:'full'},fragment:{module,entryPoint:'height',targets:[{format}]},primitive:{topology:'triangle-list'}});
 const uniform=device.createBuffer({size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});let atlases=[],capacities=[],slots=[],resident=new Map(),versions=new Map(),tileSize=0,pageBuffer,pageBytes=0;
 return {clear(){for(const atlas of atlases)atlas?.destroy();atlases=[];capacities=[];slots=[];resident.clear();versions.clear();},draw(encoder,target,{camera,tiles,cache,noOcean,min,max}){
 const ready=tiles.map(t=>({t,e:cache.get(t.key)})).filter(({e})=>e?.state==='ready'&&e.texture&&(highPrecision||e.texture&&e.textureFormat===format&&e.textureMin===min&&e.textureMax===max));
 if(ready.length>device.limits.maxTextureArrayLayers)throw Error('Globe tile count exceeds GPU texture array limit.');
 const size=ready[0]?.e.size||tileSize||512;
 if(size!==tileSize){for(const atlas of atlases)atlas?.destroy();atlases=[];capacities=[];slots=[];resident.clear();versions.clear();tileSize=size;}
 function ensurePage(page,required){
  if((capacities[page]||0)>=required)return;
  const capacity=Math.min(device.limits.maxTextureArrayLayers,2**Math.ceil(Math.log2(Math.max(1,required))));
  const texture=device.createTexture({size:[size,size,capacity],format,usage:GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING});
  if(atlases[page]){encoder.copyTextureToTexture({texture:atlases[page]},{texture},[size,size,capacities[page]]);retired.push(atlases[page]);}
  atlases[page]=texture;capacities[page]=capacity;
 }
 const retired=[];
 ensurePage(0,1);
 const active=new Set(ready.map(({e})=>e));for(let i=0;i<slots.length;i++)if(slots[i]&&!active.has(slots[i])){versions.delete(slots[i]);resident.delete(slots[i]);slots[i]=null;}
 for(const {e} of ready){let slot=resident.get(e);if(slot===undefined){slot=slots.findIndex(value=>!value);if(slot<0)slot=slots.length;slots[slot]=e;resident.set(e,slot);versions.delete(e);}if(versions.get(e)!==e.textureVersion||!versions.has(e)){const page=slot%8,layer=Math.floor(slot/8);ensurePage(page,layer+1);encoder.copyTextureToTexture({texture:e.texture},{texture:atlases[page],origin:[0,0,layer]},[size,size,1]);versions.set(e,e.textureVersion);}}
 const tableSize=2**Math.ceil(Math.log2(Math.max(4,ready.length*4))),table=new Uint32Array(tableSize*4);let maxZ=0;
 for(let i=0;i<ready.length;i++){const {x,y,z}=ready[i].t;maxZ=Math.max(maxZ,z);let slot=(Math.imul(x,73856093)^Math.imul(y,19349663)^Math.imul(z,83492791))&(tableSize-1);while(table[slot*4+3])slot=(slot+1)&(tableSize-1);table.set([x,y,z,resident.get(ready[i].e)+1],slot*4);}
 if(pageBytes<table.byteLength){pageBuffer?.destroy();pageBytes=table.byteLength;pageBuffer=device.createBuffer({size:pageBytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});}device.queue.writeBuffer(pageBuffer,0,table);const n=2**maxZ,origin=(camera.center??[.5,.5]).map(value=>value*n),base=origin.map(Math.floor);device.queue.writeBuffer(uniform,0,new Float32Array([...camera.right,0,...camera.up,0,...camera.front,0,camera.width,camera.height,camera.radius,noOcean?1:0,maxZ,tableSize-1,Math.max(0,...tiles.map(t=>t.z)),0,...base,origin[0]-base[0],origin[1]-base[1],min??0,max??1,0,0]));
 const group=device.createBindGroup({layout,entries:[{binding:0,resource:atlases[0].createView({dimension:'2d-array'})},...Array.from({length:7},(_,i)=>({binding:i+3,resource:(atlases[i+1]??atlases[0]).createView({dimension:'2d-array'})})),{binding:1,resource:{buffer:pageBuffer}},{binding:2,resource:{buffer:uniform}}]});const pass=encoder.beginRenderPass({colorAttachments:[{view:target,clearValue:{r:highPrecision?-1e30:0,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'}]});pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.draw(3);pass.end();if(retired.length)queueMicrotask(()=>device.queue.onSubmittedWorkDone().then(()=>{for(const atlas of retired)atlas.destroy();}));
 }};
}
