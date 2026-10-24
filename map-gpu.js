// Roads/borders are immutable GPU segment buffers. Text is rasterized only on
// atlas misses, then instanced as device-resolution, screen-space GPU sprites.
const strokeShader=`
struct Params{screen:vec4f,camera:vec4f,origin:vec4f}
struct Segment{ends:vec4f,style:vec4f}
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read> segments:array<Segment>;
struct Out{
 @builtin(position) position:vec4f,
 @location(0) @interpolate(flat) ends:vec4f,
 @location(1) @interpolate(flat) style:vec4f,
 @location(2) @interpolate(flat) depths:vec2f
}
fn project(uv:vec2f)->vec3f{
 let delta=(uv-p.origin.xy)*p.camera.w;
 if(p.screen.w<.5){return vec3f(p.screen.xy*.5+vec2f(delta.x,delta.y)*p.camera.x,1.);}
 let t=-6.28318530718*delta.y;let sinLat=p.origin.z;let cosLat=p.origin.w;
 var latDelta=0.;
 if(abs(t)<.001){latDelta=cosLat*t*(1.-.5*sinLat*t+(2.*sinLat*sinLat-1.)*t*t/6.);}
 else{latDelta=2.*atan(exp(p.camera.z+t))-1.57079632679-atan2(sinLat,cosLat);}
 let s=sin(latDelta);let c=cos(latDelta);let cl=cosLat*c-sinLat*s;
 let lon=6.28318530718*delta.x;let correction=2.*sin(lon*.5)*sin(lon*.5);
 let east=cl*sin(lon);let up=s+sinLat*cl*correction;let front=c-cosLat*cl*correction;
 return vec3f(p.screen.xy*.5+vec2f(east,-up)*p.camera.x,front);
}
@vertex fn stroke(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Out{
 let segment=segments[instance];var out:Out;if(p.camera.y<segment.style.y){out.position=vec4f(2.,2.,0.,1.);out.ends=vec4f(0.);out.style=vec4f(0.);out.depths=vec2f(0.);return out;}var a=project(segment.ends.xy);var b=project(segment.ends.zw);
 out.ends=vec4f(a.xy,b.xy);out.style=segment.style;out.depths=vec2f(a.z,b.z);
 if(p.camera.y<segment.style.y||max(a.z,b.z)<=.005){out.position=vec4f(2.,2.,0.,1.);return out;}
 // The tiny pre-tessellated segments can be clipped at the front hemisphere.
 if(a.z<.005){a=mix(a,b,(.005-a.z)/(b.z-a.z));}
 if(b.z<.005){b=mix(b,a,(.005-b.z)/(a.z-b.z));}
 out.ends=vec4f(a.xy,b.xy);out.depths=vec2f(a.z,b.z);
 let delta=b.xy-a.xy;let segmentLength=max(length(delta),.00001);let tangent=delta/segmentLength;let normal=vec2f(-tangent.y,tangent.x);
 let corners=array<vec2f,6>(vec2f(0.,-1.),vec2f(1.,-1.),vec2f(0.,1.),vec2f(0.,1.),vec2f(1.,-1.),vec2f(1.,1.));let corner=corners[vertex];
 let radius=segment.style.x*p.screen.z*.5+1.;
 let point=mix(a.xy,b.xy,corner.x)+tangent*((corner.x*2.-1.)*radius)+normal*corner.y*radius;
 out.position=vec4f(point/p.screen.xy*vec2f(2.,-2.)+vec2f(-1.,1.),0.,1.);return out;
}
@fragment fn ink(in:Out)->@location(0) vec4f{
 let point=in.position.xy;let delta=in.ends.zw-in.ends.xy;
 let t=clamp(dot(point-in.ends.xy,delta)/max(dot(delta,delta),.00001),0.,1.);
 let distance=length(point-mix(in.ends.xy,in.ends.zw,t));
 var coverage=clamp(in.style.x*p.screen.z*.5+.5-distance,0.,1.)*in.style.w;
 if(p.screen.w>.5){
  if(length((point-p.screen.xy*.5)/p.camera.x)>1.){discard;}
  if(in.style.z<.5){let fade=clamp((mix(in.depths.x,in.depths.y,t)-.12)/.48,0.,1.);coverage*=fade*fade*(3.-2.*fade);}
 }
 return select(vec4f(coverage,0.,0.,1.),vec4f(0.,coverage,0.,1.),in.style.z>.5);
}`;
const labelShader=`
struct Params{view:vec4f}
struct Label{anchor:vec4f,rect:vec4f,uv:vec4f}
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var<storage,read> labels:array<Label>;
@group(0) @binding(2) var atlas:texture_2d<f32>;
@group(0) @binding(3) var atlasSampler:sampler;
struct Out{@builtin(position) position:vec4f,@location(0) uv:vec2f}
@vertex fn label(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Out{
 let item=labels[instance];let corners=array<vec2f,6>(vec2f(0.,0.),vec2f(1.,0.),vec2f(0.,1.),vec2f(0.,1.),vec2f(1.,0.),vec2f(1.,1.));let uv=corners[vertex];let local=(uv-.5)*item.rect.xy;
 let point=item.anchor.xy+vec2f(local.x*item.anchor.z-local.y*item.anchor.w,local.x*item.anchor.w+local.y*item.anchor.z);
 var out:Out;out.position=vec4f(point/p.view.xy*vec2f(2.,-2.)+vec2f(-1.,1.),0.,1.);out.uv=item.rect.zw+uv*item.uv.xy;return out;
}
struct Ink{@location(0) mask:vec4f,@location(1) glyph:vec4f}
@fragment fn ink(in:Out)->Ink{
 if(p.view.w>.5&&length(in.position.xy-p.view.xy*.5)>p.view.z){discard;}
 let coverage=textureSample(atlas,atlasSampler,in.uv);var out:Ink;
 out.mask=vec4f(0.,0.,coverage.g,1.);out.glyph=vec4f(vec3f(143.,197.,255.)/255.,coverage.r);return out;
}`;
const maxBlend={color:{operation:'max',srcFactor:'one',dstFactor:'one'},alpha:{operation:'max',srcFactor:'one',dstFactor:'one'}};

class LabelAtlas{
 constructor(device){this.device=device;this.size=Math.min(2048,device.limits.maxTextureDimension2D);this.scratch=new OffscreenCanvas(1,1);this.ctx=this.scratch.getContext('2d',{alpha:false});this.items=new Map();this.dpr=0;this.uploads=0;}
 reset(dpr){this.texture?.destroy();this.texture=this.device.createTexture({size:[this.size,this.size],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});this.items.clear();this.x=this.y=this.row=0;this.dpr=dpr;}
 key(label){return `${label.font}/${label.spacing}/${label.text}`;}
 add(label){
  const key=this.key(label);if(this.items.has(key))return true;
  const dpr=this.dpr,width=Math.ceil((label.textWidth+12)*dpr),height=Math.ceil((label.size*2+8)*dpr);
  if(width>this.size||height>this.size)return false;
  if(this.x+width>this.size){this.x=0;this.y+=this.row;this.row=0;}
  if(this.y+height>this.size)return false;
  this.scratch.width=width;this.scratch.height=height;const ctx=this.ctx;
  ctx.fillStyle='black';ctx.fillRect(0,0,width,height);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.font=label.font;ctx.letterSpacing=label.spacing;ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineWidth=2;
  ctx.strokeStyle='#00ff00';ctx.fillStyle='#00ff00';ctx.strokeText(label.text,width/(2*dpr),height/(2*dpr));ctx.fillText(label.text,width/(2*dpr),height/(2*dpr));
  ctx.globalCompositeOperation='lighter';ctx.fillStyle='#ff0000';ctx.fillText(label.text,width/(2*dpr),height/(2*dpr));ctx.globalCompositeOperation='source-over';
  this.device.queue.copyExternalImageToTexture({source:this.scratch},{texture:this.texture,origin:[this.x,this.y]},[width,height]);this.uploads++;
  this.items.set(key,{width,height,x:this.x,y:this.y});this.x+=width;this.row=Math.max(this.row,height);return true;
 }
 prepare(labels,dpr,fontRevision){
  if(!this.texture||this.dpr!==dpr||this.fontRevision!==fontRevision){this.reset(dpr);this.fontRevision=fontRevision;}
  if(labels.every(label=>this.add(label)))return;
  // Drop old regions when full; repack the current view, never downsample text.
  this.reset(dpr);if(labels.every(label=>this.add(label)))return;
  if(this.size<this.device.limits.maxTextureDimension2D){this.size=Math.min(this.size*2,this.device.limits.maxTextureDimension2D,4096);this.reset(dpr);for(const label of labels)this.add(label);}
 }
 destroy(){this.texture?.destroy();this.texture=null;this.items.clear();}
}
export async function createMapPass(device){
 async function module(code){const result=device.createShaderModule({code});const errors=(await result.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(e=>e.message).join('\n'));return result;}
 const strokeModule=await module(strokeShader),labelModule=await module(labelShader);
 const strokeLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}}]});
 const labelLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{}},{binding:3,visibility:GPUShaderStage.FRAGMENT,sampler:{}}]});
 const strokePipeline=await device.createRenderPipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[strokeLayout]}),vertex:{module:strokeModule,entryPoint:'stroke'},fragment:{module:strokeModule,entryPoint:'ink',targets:[{format:'rgba8unorm',blend:maxBlend}]},primitive:{topology:'triangle-list'}});
 const labelPipeline=await device.createRenderPipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[labelLayout]}),vertex:{module:labelModule,entryPoint:'label'},fragment:{module:labelModule,entryPoint:'ink',targets:[{format:'rgba8unorm',blend:maxBlend,writeMask:GPUColorWrite.BLUE},{format:'rgba8unorm',blend:{color:{srcFactor:'one',dstFactor:'zero',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});
 const atlas=new LabelAtlas(device),resident=new Map(),slots=new Map(),sampler=device.createSampler({magFilter:'linear',minFilter:'linear'}),labelUniform=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 let mask,labels,w=0,h=0,revision=-1,lastScene=null,labelBuffer,labelCapacity=0,labelGroup,groupTexture;
 const stats={geometryUploads:0,glyphUploads:0,frames:0};
 function targets(width,height){if(mask&&w===width&&h===height)return;mask?.destroy();labels?.destroy();w=width;h=height;const descriptor={size:[w,h],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC};mask=device.createTexture(descriptor);labels=device.createTexture(descriptor);revision=-1;}
 function clear(){for(const item of resident.values())item.buffer.destroy();resident.clear();for(const item of slots.values())item.uniform.destroy();slots.clear();atlas.destroy();mask?.destroy();labels?.destroy();mask=labels=null;labelBuffer?.destroy();labelBuffer=null;labelCapacity=0;labelGroup=null;groupTexture=null;revision=-1;lastScene=null;w=h=0;}
 return {stats,clear,draw(encoder,scene,width,height){
  targets(width,height);if(revision===scene.revision&&lastScene===scene)return {mask,labels};revision=scene.revision;lastScene=scene;stats.frames++;
  for(const [entry,item] of resident)if(!scene.entries.has(entry)){item.buffer.destroy();resident.delete(entry);}
  const used=new Set(),pass=encoder.beginRenderPass({colorAttachments:[{view:mask.createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'}]});pass.setPipeline(strokePipeline);
  const {view,dpr,camera,zoom}=scene,lat=Math.atan(Math.sinh(Math.PI*(1-2*view.y))),sinLat=Math.sin(lat),cosLat=Math.cos(lat);
  for(const {tile,entry} of scene.tiles){
   const data=entry.geometry.segments;if(!data.length)continue;
   let item=resident.get(entry);if(!item){const buffer=device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(buffer,0,data);item={buffer,count:data.length/8};resident.set(entry,item);stats.geometryUploads++;}
   const key=`${tile.z}/${tile.x}/${tile.y}`;used.add(key);let slot=slots.get(key);
   if(!slot){slot={uniform:device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})};slots.set(key,slot);}
   if(slot.owner!==item){slot.owner=item;slot.group=device.createBindGroup({layout:strokeLayout,entries:[{binding:0,resource:{buffer:slot.uniform}},{binding:1,resource:{buffer:item.buffer}}]});}
   const n=2**tile.z;let originX=view.x*n-tile.x;if(camera)originX-=Math.round((originX-.5)/n)*n;device.queue.writeBuffer(slot.uniform,0,new Float32Array([w,h,dpr,camera?1:0,camera?camera.radius*dpr:256*2**view.zoom*dpr,zoom,Math.PI*(1-2*view.y),1/n,originX,view.y*n-tile.y,sinLat,cosLat]));pass.setBindGroup(0,slot.group);pass.draw(6,item.count);
  }
  pass.end();for(const [key,slot] of slots)if(!used.has(key)){slot.uniform.destroy();slots.delete(key);}
  atlas.prepare(scene.labels,dpr,scene.fontRevision);stats.glyphUploads=atlas.uploads;
  const data=new Float32Array(scene.labels.length*12);let count=0;
  for(const label of scene.labels){const sprite=atlas.items.get(atlas.key(label));if(!sprite)continue;const angle=label.angle||0;data.set([label.point[0]*dpr,label.point[1]*dpr,Math.cos(angle),Math.sin(angle),sprite.width,sprite.height,sprite.x/atlas.size,sprite.y/atlas.size,sprite.width/atlas.size,sprite.height/atlas.size,0,0],count*12);count++;}
  if(!labelBuffer||labelCapacity<data.byteLength){labelBuffer?.destroy();labelCapacity=Math.max(48,2**Math.ceil(Math.log2(Math.max(1,data.byteLength))));labelBuffer=device.createBuffer({size:labelCapacity,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});labelGroup=null;}
  if(data.byteLength)device.queue.writeBuffer(labelBuffer,0,data);device.queue.writeBuffer(labelUniform,0,new Float32Array([w,h,camera?camera.radius*dpr:0,camera?1:0]));
  if(!labelGroup||groupTexture!==atlas.texture){groupTexture=atlas.texture;labelGroup=device.createBindGroup({layout:labelLayout,entries:[{binding:0,resource:{buffer:labelUniform}},{binding:1,resource:{buffer:labelBuffer}},{binding:2,resource:atlas.texture.createView()},{binding:3,resource:sampler}]});}
  const labelPass=encoder.beginRenderPass({colorAttachments:[{view:mask.createView(),loadOp:'load',storeOp:'store'},{view:labels.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});labelPass.setPipeline(labelPipeline);labelPass.setBindGroup(0,labelGroup);if(count)labelPass.draw(6,count);labelPass.end();return {mask,labels};
 }};
}
