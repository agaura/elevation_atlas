const shader=`
struct Params{screen:vec4f,tile:vec4f,origin:vec4f,camera:vec4f}
@group(0) @binding(0) var<uniform> p:Params;
@group(0) @binding(1) var image:texture_2d<f32>;
@group(0) @binding(2) var imageSampler:sampler;
struct Out{@builtin(position) position:vec4f,@location(0) uv:vec2f,@location(1) depth:f32}
@vertex fn tile(@builtin(vertex_index) index:u32)->Out{
 let cells=u32(p.camera.w);let cell=index/6u;let corner=index%6u;
 let corners=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));
 let uv=(vec2f(f32(cell%cells),f32(cell/cells))+corners[corner])/f32(cells);
 let deltaU=p.origin.x+uv.x*p.tile.z;let deltaV=p.origin.y+uv.y*p.tile.w;
 let lon=6.28318530718*deltaU;let sinLat=p.origin.z;let cosLat=p.origin.w;
 var deltaLat=0.;
 if(p.camera.y>.5){deltaLat=-3.14159265359*deltaV;}
 else{
  let t=-6.28318530718*deltaV;
  if(abs(t)<.001){deltaLat=cosLat*t*(1.-.5*sinLat*t+(2.*sinLat*sinLat-1.)*t*t/6.);}
  else{deltaLat=2.*atan(exp(p.camera.z+t))-1.57079632679-atan2(sinLat,cosLat);}
 }
 var xy=vec2f(0.);var depth=1.;
 if(p.screen.w>.5){
  let cl=cosLat*cos(deltaLat)-sinLat*sin(deltaLat);let correction=2.*sin(lon*.5)*sin(lon*.5);
  xy=vec2f(cl*sin(lon),-(sin(deltaLat)+sinLat*cl*correction))*p.camera.x;
  depth=cos(deltaLat)-cosLat*cl*correction;
 }else{
  var mercatorDelta=deltaV;
  if(p.camera.y>.5){
   if(abs(deltaLat)<.001){let tangent=sinLat/max(cosLat,.000001);mercatorDelta=-deltaLat/(6.28318530718*max(cosLat,.000001))*(1.+.5*tangent*deltaLat+(1.+2.*tangent*tangent)*deltaLat*deltaLat/6.);}
   else{let lat=atan2(sinLat,cosLat)+deltaLat;mercatorDelta=(.5-log(tan(.78539816339+clamp(lat,-1.5707962,1.5707962)*.5))/6.28318530718)-p.tile.y;}
  }
  xy=vec2f(deltaU,mercatorDelta)*p.camera.x;
 }
 let point=xy+p.screen.xy*.5;var out:Out;out.position=vec4f(point/p.screen.xy*vec2f(2.,-2.)+vec2f(-1.,1.),0.,1.);out.uv=uv;out.depth=depth;return out;
}
@fragment fn imageColor(in:Out)->@location(0) vec4f{
 if(p.screen.w>.5&&(in.depth<=.00001||length(in.position.xy-p.screen.xy*.5)>p.camera.x)){discard;}
 return textureSampleLevel(image,imageSampler,in.uv,0.);
}`;
export async function createImageryPass(device){
 const module=device.createShaderModule({code:shader}),info=await module.getCompilationInfo();if(info.messages.some(m=>m.type==='error'))throw Error(info.messages.map(m=>m.message).join('\n'));
 const pipeline=await device.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'tile'},fragment:{module,entryPoint:'imageColor',targets:[{format:'rgba8unorm',blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});
 const sampler=device.createSampler({magFilter:'linear',minFilter:'linear'}),slots=[];let target,width=0,height=0,lastSignature='';
 return {get bytes(){return width*height*4;},draw(encoder,scene,w,h){
  if(!target||width!==w||height!==h){target?.destroy();width=w;height=h;target=device.createTexture({size:[w,h],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT});}
  const signature=[scene.source.url,scene.revision,scene.view.x,scene.view.y,scene.view.zoom,scene.dpr,scene.camera?.radius??0,w,h].join('/');
  if(signature===lastSignature)return target;lastSignature=signature;
  const pass=encoder.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});pass.setPipeline(pipeline);
  const {view,dpr,camera,source}=scene,lat=Math.atan(Math.sinh(Math.PI*(1-2*view.y))),centerV=source.geographic ? .5-lat/Math.PI : view.y;
  let index=0;
  for(const entry of scene.tiles){const {tile,texture}=entry,n=2**tile.z,cols=n*(source.geographic?2:1),west=tile.x/cols,top=tile.y/n,spanX=1/cols,spanY=1/n;
   let delta=west-view.x;delta-=Math.round(delta+spanX*.5);
   // Repeat imagery when the flat viewport spans the antimeridian/world seam.
   const flatScale=256*2**view.zoom*dpr;
   const first=Math.ceil(-w*.5/flatScale-delta-spanX),last=Math.floor(w*.5/flatScale-delta);
   const shifts=camera?[0]:Array.from({length:Math.max(0,last-first+1)},(_,i)=>first+i);
   for(const shift of shifts){const originX=delta+shift,scale=256*2**view.zoom*dpr;if(!camera&&(originX*scale>w*.5|| (originX+spanX)*scale< -w*.5))continue;
    let slot=slots[index++];if(!slot){slot={buffer:device.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})};slots.push(slot);}
    if(slot.texture!==texture){slot.texture=texture;slot.group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:slot.buffer}},{binding:1,resource:texture.createView()},{binding:2,resource:sampler}]});}
    const cells=tile.z<=1?64:16;
    device.queue.writeBuffer(slot.buffer,0,new Float32Array([w,h,dpr,camera?1:0,west,view.y,spanX,spanY,originX,top-centerV,Math.sin(lat),Math.cos(lat),camera?.radius??scale,Number(source.geographic),Math.PI*(1-2*view.y),cells]));
    pass.setBindGroup(0,slot.group);pass.draw(cells*cells*6);
   }
  }
  pass.end();return target;
 }};
}
