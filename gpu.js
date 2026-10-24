import {nativeExposure} from './precision.js';
import {createSpherePass} from './sphere-gpu.js';
import {createMapPass} from './map-gpu.js';
import {COLOR_WGSL} from './colors.js';
const quad=`struct Out{@builtin(position) position:vec4f,@location(0) uv:vec2f}
@vertex fn full(@builtin(vertex_index)i:u32)->Out{let points=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));var o:Out;o.position=vec4f(points[i],0,1);o.uv=vec2f((points[i].x+1)*.5,(1-points[i].y)*.5);return o;}`;
const params=`struct Params{rect:vec4f,range:vec4f,screen:vec4f,effects:vec4f,highlight:vec4f,encoding:vec4f}
@group(0) @binding(0) var terrain:texture_2d<f32>;
@group(0) @binding(1) var<uniform> p:Params;
@group(0) @binding(2) var mapMask:texture_2d<f32>;
@group(0) @binding(3) var mapLabels:texture_2d<f32>;`;
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
fn mapInk(color:vec3f)->vec3f{
 let inkLuminance=select(.88,1.15,p.range.w>1.5);
 if(p.range.z<.5){return vec3f(inkLuminance);}
 let luminance=dot(color,vec3f(.2289746,.6917385,.0792869));
 var ink=color*(inkLuminance/max(luminance,.00001));
 if(p.range.w<=1.5){
  // SDR cannot carry saturated blue at white luminance; reduce chroma to fit.
  let peak=max(ink.r,max(ink.g,ink.b));
  if(peak>1.){ink=mix(vec3f(inkLuminance),ink,(1.-inkLuminance)/max(peak-inkLuminance,.00001));}
 }
 return ink;
}

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
let coord=vec2i(o.position.xy);let legend=p.screen.z>.5;var t=o.uv.x;var elevation=mix(p.range.x,p.range.y,t);var validTerrain=true;
if(!legend){let value=textureLoad(terrain,coord,0).r;validTerrain=value>=-40000&&value<=40000;if(validTerrain){elevation=value;t=clamp((value-p.range.x)/max(p.range.y-p.range.x,.00001),0.,1.);}}
let colorT=select(t,1.-t,p.highlight.z>.5);var c=vec3f(colorT);let emphasis=p.effects.y>.5;
let weight=pow(max(0.,1.-abs(elevation-p.highlight.x)/max(p.highlight.y,.0000001)),2.);
if(p.range.z<.5&&emphasis){let base=linearP3ToOKLab(decodeSRGB(c));let peak=linearP3ToOKLab(vec3f(p.range.w));c=oklabToP3(mix(base,peak,weight));}
if(p.range.z>.5){var lab:vec3f;if(p.range.z>1.5){lab=colorMapAntarctica(colorT,p.effects.x,weight,p.range.w,emphasis);}else{lab=colorMapThermal(colorT,p.effects.x,weight,p.range.w,emphasis);}c=max(oklabToP3(lab),vec3f(0));}
if(!legend&&validTerrain&&p.effects.z>0.&&textureLoad(terrain,coord,0).g>0.){let edgeCenter=(elevation-p.range.x)/max(p.range.y-p.range.x,.00001);let edge=sobel(coord,edgeCenter,textureLoad(terrain,coord,0).g);let linearColor=decodeSRGB(c);var scale=mix(1.,clamp(mix(1.,6.,pow(edge,.7))-.6,.5,4.),p.effects.z);scale=min(scale,decodeSRGBComponent(3.95)/max(max(linearColor.x,max(linearColor.y,linearColor.z)),.000001));c=encodeSRGB(linearColor*scale);}
if(!legend&&!validTerrain){c=select(vec3f(.012,.014,.016),vec3f(.014),p.range.z<.5);}
if(!legend&&p.highlight.w>.5){
 let mask=textureLoad(mapMask,coord,0).rgb;
 var linear=decodeSRGB(c);
 let luminance=dot(linear,vec3f(.2289746,.6917385,.0792869));
 // Roads act on the terrain itself, retaining its luminance structure.
 linear=mix(linear,vec3f(luminance),.5*mask.r);
 linear*=1.+2.*mask.r;
 linear=mix(linear,mapInk(decodeSRGB(vec3f(.47,.72,.96))),mask.g);
 // Label backgrounds and glyphs are composited after every map/terrain effect.
 linear=mix(linear,select(vec3f(.002,.004,.008),vec3f(.004),p.range.z<.5),mask.b);
 let label=textureLoad(mapLabels,coord,0);linear=mix(linear,mapInk(decodeSRGB(label.rgb)),label.a);c=encodeSRGB(linear);
}
if(p.screen.w<.5){c=encodeSRGB(LINEAR_P3_TO_LINEAR_SRGB*decodeSRGB(c));}return vec4f(c,1);}`;
const reductionShader=`@group(0) @binding(0) var terrain:texture_2d<f32>;
@group(0) @binding(1) var<storage,read_write> results:array<vec2f>;
var<workgroup> lows:array<f32,256>;var<workgroup> highs:array<f32,256>;
@compute @workgroup_size(256) fn reduce(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3u){let dims=textureDimensions(terrain);var lo=1e30;var hi=-1e30;for(var i=0u;i<16u;i++){let index=group.x*4096u+lane+i*256u;if(index<dims.x*dims.y){let v=textureLoad(terrain,vec2i(i32(index%dims.x),i32(index/dims.x)),0).r;if(v>=-40000&&v<=40000){lo=min(lo,v);hi=max(hi,v);}}}lows[lane]=lo;highs[lane]=hi;workgroupBarrier();for(var stride=128u;stride>0u;stride/=2u){if(lane<stride){lows[lane]=min(lows[lane],lows[lane+stride]);highs[lane]=max(highs[lane],highs[lane+stride]);}workgroupBarrier();}if(lane==0u){results[group.x]=vec2f(lows[0],highs[0]);}}`;
const bytePacking=`
fn packHeight(value:vec2f)->vec2f{
 if(!(value.x>=-40000.&&value.x<=40000.)){return vec2f(0.);}
 let q=round(clamp((value.x-p.encoding.x)/max(p.encoding.y-p.encoding.x,.00001),0.,1.)*255.)/255.;
 var metadata=1.;if(value.y>0.){metadata=2.;if(value.y>1.){metadata=min(255.,2.+round(log2(value.y)*8.));}}return vec2f(q,metadata/255.);
}
fn sourceLoad(tex:texture_2d<f32>,xy:vec2i,level:i32)->vec4f{
 let value=textureLoad(tex,xy,level);let code=u32(round(value.g*255.));if(code==0u){return vec4f(-1e30,0.,0.,0.);}
 let exponent=(code&127u)-1u;var spacing=1.;if(exponent>0u){spacing=exp2(f32(exponent));}let kind=spacing*select(1.,-1.,(code&128u)!=0u);
 return vec4f(mix(p.encoding.x,p.encoding.y,value.r),kind,0.,0.);
}
`;
const heightShader8=heightShader.replaceAll('textureLoad(', 'sourceLoad(').replace('return vec2f(-1e30,1);','return vec2f(0.);').replace('return vec2f(mix(', 'return packHeight(vec2f(mix(').replace('p.highlight.w>.5));','p.highlight.w>.5)));')+bytePacking;
const colorShader8=colorShader.replaceAll('textureLoad(terrain,','screenLoad(terrain,')+`
fn screenLoad(tex:texture_2d<f32>,xy:vec2i,level:i32)->vec4f{
 let value=textureLoad(tex,xy,level);let code=round(value.g*255.);if(code<.5){return vec4f(-1e30,0.,0.,0.);}
 var footprint=0.;if(code>1.5){footprint=1.;if(code>2.5){footprint=exp2((code-2.)/8.);}}return vec4f(mix(p.encoding.x,p.encoding.y,value.r),footprint,0.,0.);
}`;
export async function createRenderer(device,format,context,legendContext){
 const layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float'}},{binding:1,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float'}},{binding:3,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float'}}]});const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
 async function make(code,vertex,fragment,target){const module=device.createShaderModule({code});const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(e=>e.message).join('\n'));return device.createRenderPipelineAsync({layout:pipelineLayout,vertex:{module,entryPoint:vertex},fragment:{module,entryPoint:fragment,targets:[{format:target}]},primitive:{topology:'triangle-list'}});}
 const heightPipeline=await make(heightShader,'tile','height','rg32float'),colorPipeline=await make(colorShader,'full','color',format),heightPipeline8=await make(heightShader8,'tile','height','rg8unorm'),colorPipeline8=await make(colorShader8,'full','color',format);
 const spherePass=await createSpherePass(device),spherePass8=await createSpherePass(device,{highPrecision:false}),mapPass=await createMapPass(device);let gpuMapActive=false;
 const reducePipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:device.createShaderModule({code:reductionShader}),entryPoint:'reduce'}});
 let maskTexture=device.createTexture({size:[1,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT}),maskWidth=1,maskHeight=1,maskRevision=-1;
 let labelTexture=device.createTexture({size:[1,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT}),labelWidth=1,labelHeight=1;
 let screen,screenView,w=0,h=0,screenFormat='rg32float',lastMin,lastMax,precision=true,encodingRange=[0,1,0,0],uniforms=[],reductionBusy=false,heightDirty=true;
 function resize(width,height,format){if(width===w&&height===h&&format===screenFormat)return;screenFormat=format;screen?.destroy();w=width;h=height;screen=device.createTexture({size:[w,h],format:screenFormat,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});screenView=screen.createView();heightDirty=true;}
 function bind(texture,index,data){let u=uniforms[index];if(!u){u={buffer:device.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})};uniforms[index]=u;}if(u.texture!==texture||u.mask!==maskTexture||u.labels!==labelTexture){u.texture=texture;u.mask=maskTexture;u.labels=labelTexture;u.group=device.createBindGroup({layout,entries:[{binding:0,resource:texture.createView()},{binding:1,resource:{buffer:u.buffer}},{binding:2,resource:maskTexture.createView()},{binding:3,resource:labelTexture.createView()}]});}device.queue.writeBuffer(u.buffer,0,new Float32Array([...data,...encodingRange]));return u.group;}
 return {invalidate(){heightDirty=true;},render({tiles,cache,dpr,canvas,legend,min,max,palette,reversed=false,hdr,p3,selected=.5,selectedElevation=min+selected*(max-min),highlightWidth=(max-min)/8,emphasis,edges,noOcean,sphere=null,mapOverlay=null,highPrecision=true,encodingMin=min,encodingMax=max,reduce,onExposure}){
 if(precision!==highPrecision){spherePass.clear();spherePass8.clear();precision=highPrecision;heightDirty=true;}
 if(!highPrecision&&(encodingMin!==lastMin||encodingMax!==lastMax))heightDirty=true;lastMin=encodingMin;lastMax=encodingMax;encodingRange=[encodingMin,encodingMax,0,0];
 resize(canvas.width,canvas.height,highPrecision?'rg32float':'rg8unorm');
 const encoder=device.createCommandEncoder();
 if(mapOverlay?.gpu){
  if(!gpuMapActive){maskTexture.destroy();labelTexture.destroy();gpuMapActive=true;}
  const output=mapPass.draw(encoder,mapOverlay,w,h);maskTexture=output.mask;labelTexture=output.labels;maskWidth=labelWidth=w;maskHeight=labelHeight=h;
 }else{
 if(gpuMapActive){mapPass.clear();gpuMapActive=false;maskTexture=device.createTexture({size:[1,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});labelTexture=device.createTexture({size:[1,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});maskWidth=maskHeight=labelWidth=labelHeight=1;maskRevision=-1;}
 if(!mapOverlay&&(maskWidth!==1||maskHeight!==1)){
  maskTexture.destroy();maskTexture=device.createTexture({size:[1,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});maskWidth=maskHeight=1;maskRevision=-1;
 }
 if(!mapOverlay&&(labelWidth!==1||labelHeight!==1)){
  labelTexture.destroy();labelTexture=device.createTexture({size:[1,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});labelWidth=labelHeight=1;
 }
 if(mapOverlay&&(maskRevision!==mapOverlay.revision||maskWidth!==w||maskHeight!==h)){
  if(maskWidth!==w||maskHeight!==h){maskTexture.destroy();maskTexture=device.createTexture({size:[w,h],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});maskWidth=w;maskHeight=h;}
  const lw=mapOverlay.labels?w:1,lh=mapOverlay.labels?h:1;
  if(labelWidth!==lw||labelHeight!==lh){labelTexture.destroy();labelTexture=device.createTexture({size:[lw,lh],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});labelWidth=lw;labelHeight=lh;}
  if(mapOverlay.labels)device.queue.copyExternalImageToTexture({source:mapOverlay.labels},{texture:labelTexture,premultipliedAlpha:false},[w,h]);
  device.queue.copyExternalImageToTexture({source:mapOverlay.canvas},{texture:maskTexture},[w,h]);maskRevision=mapOverlay.revision;
 }
 }
 let index=0;const tail=[min,max,palette,hdr,w,h,0,p3,selected,emphasis?1:0,edges,noOcean?1:0,selectedElevation,highlightWidth,0,0];
 if(heightDirty&&sphere){(highPrecision?spherePass:spherePass8).draw(encoder,screenView,{camera:sphere,tiles,cache,noOcean,min:encodingMin,max:encodingMax});heightDirty=false;}
 if(heightDirty){const pass=encoder.beginRenderPass({colorAttachments:[{view:screenView,clearValue:{r:highPrecision?-1e30:0,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'}]});pass.setPipeline(highPrecision?heightPipeline:heightPipeline8);for(const t of tiles){const e=cache.get(t.sourceKey??t.key);if(e?.state==='ready'){pass.setBindGroup(0,bind(e.texture,index++,[t.left*dpr,t.top*dpr,t.size*dpr,t.size*dpr,...tail.slice(0,12),...(t.uv??[0,0,1]),t.sourceKey?1:0]));pass.draw(6);}}pass.end();heightDirty=false;}
 // Fixed slots for presentation avoid rebuilding bind groups as tile count changes.
 for(const [ctx,isLegend,slot] of [[context,false,0],[legendContext,true,1]]){const pass=encoder.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});pass.setPipeline(highPrecision?colorPipeline:colorPipeline8);pass.setBindGroup(0,bind(screen,tiles.length+slot,[0,0,0,0,min,max,palette,hdr,isLegend?legend.width:w,isLegend?legend.height:h,isLegend?1:0,p3,selected,emphasis?1:0,edges,noOcean?1:0,selectedElevation,highlightWidth,reversed?1:0,!isLegend&&mapOverlay?1:0]));pass.draw(3);pass.end();}
 let readback,output,groups,nativeBounds;if(reduce&&!highPrecision&&!reductionBusy)nativeBounds=nativeExposure({tiles,cache,sphere,width:w,height:h,dpr,noOcean});if(reduce&&highPrecision&&!reductionBusy){groups=Math.ceil(w*h/4096);output=device.createBuffer({size:groups*8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});readback=device.createBuffer({size:groups*8,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const pass=encoder.beginComputePass();pass.setPipeline(reducePipeline);pass.setBindGroup(0,device.createBindGroup({layout:reducePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:screenView},{binding:1,resource:{buffer:output}}]}));pass.dispatchWorkgroups(groups);pass.end();encoder.copyBufferToBuffer(output,0,readback,0,groups*8);reductionBusy=true;}
 device.queue.submit([encoder.finish()]);if(nativeBounds){queueMicrotask(()=>onExposure(...nativeBounds));return true;}if(readback){readback.mapAsync(GPUMapMode.READ).then(()=>{const values=new Float32Array(readback.getMappedRange());let lo=1e30,hi=-1e30;for(let i=0;i<values.length;i+=2){lo=Math.min(lo,values[i]);hi=Math.max(hi,values[i+1]);}readback.unmap();reductionBusy=false;onExposure(lo,hi);}).catch(error=>{reductionBusy=false;console.warn('Exposure readback failed',error);}).finally(()=>{readback.destroy();output.destroy();});return true;}return false;
 }};
}
