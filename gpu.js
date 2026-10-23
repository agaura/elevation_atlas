import {createSpherePass} from './sphere-gpu.js';
import {COLOR_WGSL} from './colors.js';
const quad=`struct Out{@builtin(position) position:vec4f,@location(0) uv:vec2f}
@vertex fn full(@builtin(vertex_index)i:u32)->Out{let points=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));var o:Out;o.position=vec4f(points[i],0,1);o.uv=vec2f((points[i].x+1)*.5,(1-points[i].y)*.5);return o;}`;
const params=`struct Params{rect:vec4f,range:vec4f,screen:vec4f,effects:vec4f,highlight:vec4f}
@group(0) @binding(0) var terrain:texture_2d<f32>;
@group(0) @binding(1) var<uniform> p:Params;`;
const heightShader=params+quad+`
@vertex fn tile(@builtin(vertex_index)i:u32)->Out{let points=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));let uv=points[i];var o:Out;o.uv=uv;let xy=(p.rect.xy+uv*p.rect.zw)/p.screen.xy;o.position=vec4f(xy.x*2-1,1-xy.y*2,0,1);return o;}
fn valid(v:vec4f,center:vec4f)->f32{if(!(v.x>=-40000&&v.x<=40000)||sign(v.y)!=sign(center.y)){return center.x;}return v.x;}
@fragment fn height(o:Out)->@location(0) vec2f{
 let dims=textureDimensions(terrain);let uv=p.highlight.xy+o.uv*p.highlight.z;let xy=uv*vec2f(dims)-.5;let base=vec2i(floor(xy));let f=fract(xy);let limit=vec2i(dims)-1;
 let nearest=textureLoad(terrain,clamp(vec2i(floor(xy+.5)),vec2i(0),limit),0);
 if(!(nearest.x>=-40000&&nearest.x<=40000)||(p.effects.w>.5&&nearest.y<0.)){return vec2f(-1e30,1);}
 let a=valid(textureLoad(terrain,clamp(base,vec2i(0),limit),0),nearest);let b=valid(textureLoad(terrain,clamp(base+vec2i(1,0),vec2i(0),limit),0),nearest);
 let c=valid(textureLoad(terrain,clamp(base+vec2i(0,1),vec2i(0),limit),0),nearest);let d=valid(textureLoad(terrain,clamp(base+vec2i(1,1),vec2i(0),limit),0),nearest);
 return vec2f(mix(mix(a,b,f.x),mix(c,d,f.x),f.y),select(max(1.,p.rect.z/(f32(dims.x)*p.highlight.z)*max(1.,abs(nearest.y))),0.,p.highlight.w>.5));
}`;
const colorShader=COLOR_WGSL+params+quad+`
fn normalizedAt(coord:vec2i,center:f32)->f32{let dims=vec2i(textureDimensions(terrain));let sample=textureLoad(terrain,clamp(coord,vec2i(0),dims-1),0);let v=sample.r;if(!(v>=-40000&&v<=40000)||sample.g<=0.){return center;}return (v-p.range.x)/max(p.range.y-p.range.x,.00001);}
fn neighbor(coord:vec2i,offset:vec2i,radius:f32,center:f32)->f32{
 if(radius<=1.){return normalizedAt(coord+offset,center);}
 let xy=vec2f(coord)+vec2f(offset)*radius;let base=vec2i(floor(xy));let f=fract(xy);
 return mix(mix(normalizedAt(base,center),normalizedAt(base+vec2i(1,0),center),f.x),mix(normalizedAt(base+vec2i(0,1),center),normalizedAt(base+vec2i(1,1),center),f.x),f.y);
}
fn sobel(coord:vec2i,center:f32,radius:f32)->f32{
let tl=neighbor(coord,vec2i(-1,-1),radius,center);let tc=neighbor(coord,vec2i(0,-1),radius,center);let tr=neighbor(coord,vec2i(1,-1),radius,center);let ml=neighbor(coord,vec2i(-1,0),radius,center);let mr=neighbor(coord,vec2i(1,0),radius,center);let bl=neighbor(coord,vec2i(-1,1),radius,center);let bc=neighbor(coord,vec2i(0,1),radius,center);let br=neighbor(coord,vec2i(1,1),radius,center);
return length(vec2f(-tl-2.*ml-bl+tr+2.*mr+br,-tl-2.*tc-tr+bl+2.*bc+br));}
@fragment fn color(o:Out)->@location(0) vec4f{
let coord=vec2i(o.position.xy);let legend=p.screen.z>.5;var t=o.uv.x;var elevation=mix(p.range.x,p.range.y,t);
if(!legend){let value=textureLoad(terrain,coord,0).r;if(!(value>=-40000&&value<=40000)){return vec4f(.012,.014,.016,1);}elevation=value;t=clamp((value-p.range.x)/max(p.range.y-p.range.x,.00001),0.,1.);}
let colorT=select(t,1.-t,p.highlight.z>.5);var c=vec3f(colorT);let emphasis=p.effects.y>.5;
let weight=pow(max(0.,1.-abs(elevation-p.highlight.x)/max(p.highlight.y,.0000001)),2.);
if(p.range.z<.5&&emphasis){let base=linearP3ToOKLab(decodeSRGB(c));let peak=linearP3ToOKLab(vec3f(p.range.w));c=oklabToP3(mix(base,peak,weight));}
if(p.range.z>.5){var lab:vec3f;if(p.range.z>1.5){lab=colorMapAntarctica(colorT,p.effects.x,weight,p.range.w,emphasis);}else{lab=colorMapThermal(colorT,p.effects.x,weight,p.range.w,emphasis);}c=max(oklabToP3(lab),vec3f(0));}
if(!legend&&p.effects.z>0.&&textureLoad(terrain,coord,0).g>0.){let edgeCenter=(elevation-p.range.x)/max(p.range.y-p.range.x,.00001);let edge=sobel(coord,edgeCenter,textureLoad(terrain,coord,0).g);let linearColor=decodeSRGB(c);var scale=mix(1.,clamp(mix(1.,6.,pow(edge,.7))-.6,.5,4.),p.effects.z);scale=min(scale,decodeSRGBComponent(3.95)/max(max(linearColor.x,max(linearColor.y,linearColor.z)),.000001));c=encodeSRGB(linearColor*scale);}
if(p.screen.w<.5){c=encodeSRGB(LINEAR_P3_TO_LINEAR_SRGB*decodeSRGB(c));}return vec4f(c,1);}`;
const reductionShader=`@group(0) @binding(0) var terrain:texture_2d<f32>;
@group(0) @binding(1) var<storage,read_write> results:array<vec2f>;
var<workgroup> lows:array<f32,256>;var<workgroup> highs:array<f32,256>;
@compute @workgroup_size(256) fn reduce(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3u){let dims=textureDimensions(terrain);var lo=1e30;var hi=-1e30;for(var i=0u;i<16u;i++){let index=group.x*4096u+lane+i*256u;if(index<dims.x*dims.y){let v=textureLoad(terrain,vec2i(i32(index%dims.x),i32(index/dims.x)),0).r;if(v>=-40000&&v<=40000){lo=min(lo,v);hi=max(hi,v);}}}lows[lane]=lo;highs[lane]=hi;workgroupBarrier();for(var stride=128u;stride>0u;stride/=2u){if(lane<stride){lows[lane]=min(lows[lane],lows[lane+stride]);highs[lane]=max(highs[lane],highs[lane+stride]);}workgroupBarrier();}if(lane==0u){results[group.x]=vec2f(lows[0],highs[0]);}}`;
export async function createRenderer(device,format,context,legendContext){
 const layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float'}},{binding:1,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
 async function make(code,vertex,fragment,target){const module=device.createShaderModule({code});const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(e=>e.message).join('\n'));return device.createRenderPipelineAsync({layout:pipelineLayout,vertex:{module,entryPoint:vertex},fragment:{module,entryPoint:fragment,targets:[{format:target}]},primitive:{topology:'triangle-list'}});}
 const heightPipeline=await make(heightShader,'tile','height','rg32float'),colorPipeline=await make(colorShader,'full','color',format);
 const spherePass=await createSpherePass(device);
 const reducePipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:device.createShaderModule({code:reductionShader}),entryPoint:'reduce'}});
 let screen,screenView,w=0,h=0,uniforms=[],reductionBusy=false,heightDirty=true;
 function resize(width,height){if(width===w&&height===h)return;screen?.destroy();w=width;h=height;screen=device.createTexture({size:[w,h],format:'rg32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});screenView=screen.createView();heightDirty=true;}
 function bind(texture,index,data){let u=uniforms[index];if(!u){u={buffer:device.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})};uniforms[index]=u;}if(u.texture!==texture){u.texture=texture;u.group=device.createBindGroup({layout,entries:[{binding:0,resource:texture.createView()},{binding:1,resource:{buffer:u.buffer}}]});}device.queue.writeBuffer(u.buffer,0,new Float32Array(data));return u.group;}
 return {invalidate(){heightDirty=true;},render({tiles,cache,dpr,canvas,legend,min,max,palette,reversed=false,hdr,p3,selected=.5,selectedElevation=min+selected*(max-min),highlightWidth=(max-min)/8,emphasis,edges,noOcean,sphere=null,reduce,onExposure}){
 resize(canvas.width,canvas.height);const encoder=device.createCommandEncoder();let index=0;const tail=[min,max,palette,hdr,w,h,0,p3,selected,emphasis?1:0,edges,noOcean?1:0,selectedElevation,highlightWidth,0,0];
 if(heightDirty&&sphere){spherePass.draw(encoder,screenView,{camera:sphere,tiles,cache,noOcean});heightDirty=false;}
 if(heightDirty){const pass=encoder.beginRenderPass({colorAttachments:[{view:screenView,clearValue:{r:-1e30,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'}]});pass.setPipeline(heightPipeline);for(const t of tiles){const e=cache.get(t.sourceKey??t.key);if(e?.state==='ready'){pass.setBindGroup(0,bind(e.texture,index++,[t.left*dpr,t.top*dpr,t.size*dpr,t.size*dpr,...tail.slice(0,12),...(t.uv??[0,0,1]),t.sourceKey?1:0]));pass.draw(6);}}pass.end();heightDirty=false;}
 // Fixed slots for presentation avoid rebuilding bind groups as tile count changes.
 for(const [ctx,isLegend,slot] of [[context,false,0],[legendContext,true,1]]){const pass=encoder.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});pass.setPipeline(colorPipeline);pass.setBindGroup(0,bind(screen,tiles.length+slot,[0,0,0,0,min,max,palette,hdr,isLegend?legend.width:w,isLegend?legend.height:h,isLegend?1:0,p3,selected,emphasis?1:0,edges,noOcean?1:0,selectedElevation,highlightWidth,reversed?1:0,0]));pass.draw(3);pass.end();}
 let readback,output,groups;if(reduce&&!reductionBusy){groups=Math.ceil(w*h/4096);output=device.createBuffer({size:groups*8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});readback=device.createBuffer({size:groups*8,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const pass=encoder.beginComputePass();pass.setPipeline(reducePipeline);pass.setBindGroup(0,device.createBindGroup({layout:reducePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:screenView},{binding:1,resource:{buffer:output}}]}));pass.dispatchWorkgroups(groups);pass.end();encoder.copyBufferToBuffer(output,0,readback,0,groups*8);reductionBusy=true;}
 device.queue.submit([encoder.finish()]);if(readback){readback.mapAsync(GPUMapMode.READ).then(()=>{const values=new Float32Array(readback.getMappedRange());let lo=1e30,hi=-1e30;for(let i=0;i<values.length;i+=2){lo=Math.min(lo,values[i]);hi=Math.max(hi,values[i+1]);}readback.unmap();reductionBusy=false;onExposure(lo,hi);}).catch(error=>{reductionBusy=false;console.warn('Exposure readback failed',error);}).finally(()=>{readback.destroy();output.destroy();});return true;}return false;
 }};
}
