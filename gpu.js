import {createImageryPass} from './imagery-gpu.js';
import {PALETTE_ACCENT_WGSL} from './palette-accent.js';
import {captureTexture} from './frame-capture.js';
import {SOURCE_GRADIENT_WGSL} from './terrain-gradient.js';
import {createSpherePass} from './sphere-gpu.js';
import {createMapPass} from './map-gpu.js';
import {COLOR_WGSL,COLOR_MAPS} from './colors.js';
const quad=`struct Out{@builtin(position) position:vec4f,@location(0) uv:vec2f}
@vertex fn full(@builtin(vertex_index)i:u32)->Out{let points=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));var o:Out;o.position=vec4f(points[i],0,1);o.uv=vec2f((points[i].x+1)*.5,(1-points[i].y)*.5);return o;}`;
const params=`struct Params{rect:vec4f,range:vec4f,screen:vec4f,effects:vec4f,highlight:vec4f,maskView:vec4f,maskBounds:vec4f,maskCenter:vec4f,maskRight:vec4f,maskUp:vec4f,maskFront:vec4f,edgeRange:vec4f}
@group(0) @binding(0) var terrain:texture_2d<f32>;
@group(0) @binding(1) var<uniform> p:Params;
@group(0) @binding(2) var mapMask:texture_2d<f32>;
@group(0) @binding(3) var mapLabels:texture_2d<f32>;
@group(0) @binding(4) var regionMaskTexture:texture_2d<f32>;
@group(0) @binding(5) var satelliteImage:texture_2d<f32>;`;
const heightShader=params+quad+SOURCE_GRADIENT_WGSL+`
fn sourceSize()->vec2i{return vec2i(textureDimensions(terrain));}
fn sourceValue(coord:vec2i,layer:i32)->vec4f{return textureLoad(terrain,coord,0);}

@vertex fn tile(@builtin(vertex_index)i:u32)->Out{let points=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));let uv=points[i];var o:Out;o.uv=uv;let xy=(p.rect.xy+uv*p.rect.zw)/p.screen.xy;o.position=vec4f(xy.x*2-1,1-xy.y*2,0,1);return o;}
fn valid(v:vec4f,center:vec4f)->f32{if(!(v.x>=-40000&&v.x<=40000)||sign(v.y)!=sign(center.y)){return center.x;}return v.x;}
@fragment fn height(o:Out)->@location(0) vec2f{
 let dims=textureDimensions(terrain);// Derive UVs from device-pixel positions, avoiding rasterizer subpixel
 // snapping of the tile quad's interpolated UVs during fractional pans.
 let uv=p.highlight.xy+(o.position.xy-p.rect.xy)/p.rect.zw*p.highlight.z;let xy=uv*vec2f(dims)-.5;let base=vec2i(floor(xy));let f=fract(xy);let limit=vec2i(dims)-1;
 let nearest=textureLoad(terrain,clamp(vec2i(floor(xy+.5)),vec2i(0),limit),0);
 if(!(nearest.x>=-40000&&nearest.x<=40000)){return vec2f(-1e30,1);}
 let a=valid(textureLoad(terrain,clamp(base,vec2i(0),limit),0),nearest);let b=valid(textureLoad(terrain,clamp(base+vec2i(1,0),vec2i(0),limit),0),nearest);
 let c=valid(textureLoad(terrain,clamp(base+vec2i(0,1),vec2i(0),limit),0),nearest);let d=valid(textureLoad(terrain,clamp(base+vec2i(1,1),vec2i(0),limit),0),nearest);
 // Pack water classification into the edge channel: -1.5 means water
 // without a gradient; values <= -2 encode -(2 + gradient).
 var edge = -1.;
 if(p.effects.z>0.&&p.highlight.w<.5){edge=sourceEdge(xy,nearest.y,0);}
 return vec2f(mix(mix(a,b,f.x),mix(c,d,f.x),f.y),select(edge,select(-1.5,-2.-edge,edge>=0.),nearest.y<0.));
}`;
const colorShader=COLOR_WGSL+PALETTE_ACCENT_WGSL+params+quad+`
fn mapInk()->vec3f{
 let color=LINEAR_SRGB_TO_LINEAR_P3*decodeSRGB(paletteAccent(p.range.z));
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

fn regionCoverage(position:vec2f)->f32{
 let pixel=position-p.screen.xy*.5;var local:vec2f;
 if(p.maskView.y>.5){
  let disk=vec2f(pixel.x,-pixel.y)/p.maskView.z;let depth=1.-dot(disk,disk);if(depth<0.){return 0.;}
  let point=p.maskRight.xyz*disk.x+p.maskUp.xyz*disk.y+p.maskFront.xyz*sqrt(depth);
  let u=atan2(point.x,point.z)/6.28318530718+.5;
  let lat=asin(clamp(point.y,-.9999999,.9999999));
  let v=.5-log(tan(.78539816339+lat*.5))/6.28318530718;
  let delta=u-p.maskView.w;local=vec2f(delta-floor(delta+.5)+p.maskCenter.z,v-p.maskCenter.w);
 }else{
  let delta=p.maskCenter.x+pixel.x/p.maskView.z;
  local=vec2f(delta-floor(delta+.5)+p.maskCenter.z,p.maskCenter.y+pixel.y/p.maskView.z);
 }
 let uv=local/p.maskBounds.zw;if(any(uv<vec2f(0.))||any(uv>vec2f(1.))){return 0.;}
 let dims=vec2i(textureDimensions(regionMaskTexture));let xy=uv*vec2f(dims)-.5;let base=vec2i(floor(xy));let f=fract(xy);
 let a=textureLoad(regionMaskTexture,clamp(base,vec2i(0),dims-1),0).r;
 let b=textureLoad(regionMaskTexture,clamp(base+vec2i(1,0),vec2i(0),dims-1),0).r;
 let c=textureLoad(regionMaskTexture,clamp(base+vec2i(0,1),vec2i(0),dims-1),0).r;
 let d=textureLoad(regionMaskTexture,clamp(base+vec2i(1,1),vec2i(0),dims-1),0).r;
 return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}

@fragment fn color(o:Out)->@location(0) vec4f{
let coord=vec2i(o.position.xy);let legend=p.screen.z>.5;var t=select(o.uv.x,1.-o.uv.y,p.screen.z>2.5);var elevation=mix(p.range.x,p.range.y,t);var validTerrain=true;var water=false;var terrainEdge = -1.;
if(p.screen.z>1.5&&p.screen.z<2.5){elevation=p.highlight.x;t=clamp((elevation-p.range.x)/max(p.range.y-p.range.x,.00001),0.,1.);}
if(!legend){let sample=textureLoad(terrain,coord,0);let value=sample.r;water=sample.g< -1.;terrainEdge=select(sample.g,-2.-sample.g,sample.g<= -2.);validTerrain=value>=-40000&&value<=40000;if(validTerrain){elevation=value;t=clamp((value-p.range.x)/max(p.range.y-p.range.x,.00001),0.,1.);}}
// Derivatives stay outside varying branches for valid WebGPU uniformity.
let contourFootprint=max(fwidth(elevation),.0001);
let colorT=select(t,1.-t,p.highlight.z>.5);var c=vec3f(colorT);let emphasis=p.effects.y>0.;
let weight=pow(max(0.,1.-abs(elevation-p.highlight.x)/max(p.highlight.y,.0000001)),2.)*clamp(p.effects.y,0.,1.);
if(p.range.z<.5&&emphasis){let base=linearP3ToOKLab(decodeSRGB(c));let peak=linearP3ToOKLab(vec3f(p.range.w));c=oklabToP3(mix(base,peak,weight));}
if(p.range.z>.5){var lab:vec3f;switch u32(p.range.z){
${COLOR_MAPS.filter(map=>map.shader).map(map=>`case ${map.id}u:{lab=${map.shader}(colorT,p.effects.x,weight,p.range.w,emphasis);}`).join('\n')}
default:{lab=colorMapThermal(colorT,p.effects.x,weight,p.range.w,emphasis);}}c=max(oklabToP3(lab),vec3f(0));}
var imageryCoverage=0.;
if(!legend&&p.edgeRange.w>.5){
 let image=textureLoad(satelliteImage,coord,0);imageryCoverage=image.a;
 let linear=LINEAR_SRGB_TO_LINEAR_P3*decodeSRGB(image.rgb);
 // Missing imagery stays neutral rather than exposing the elevation palette.
 c=encodeSRGB(mix(decodeSRGB(vec3f(.012,.014,.016)),linear,image.a));
}
if(!legend&&p.edgeRange.w<.5&&validTerrain&&p.effects.z>0.&&terrainEdge>=0.){let edge=terrainEdge/max(max(p.range.y-p.range.x,p.edgeRange.x),.00001);let linearColor=decodeSRGB(c);var scale=mix(1.,clamp(mix(.5,5.5,pow(edge,.75)),.5,4.),p.effects.z);scale=min(scale,8./max(max(linearColor.x,max(linearColor.y,linearColor.z)),.000001));c=encodeSRGB(linearColor*scale);}
if((legend||p.edgeRange.w<.5||imageryCoverage>.001)&&validTerrain&&p.edgeRange.z>.5&&elevation>=p.range.x&&elevation<=p.range.y&&(p.screen.z<1.5||p.screen.z>2.5)){
 let interval=p.edgeRange.y;
 let level=round(elevation/interval)*interval;
 let distance=abs(elevation-level)/contourFootprint;
 // Suppress sub-pixel contour frequencies instead of producing moire.
 let resolved=1.-smoothstep(interval*.15,interval*.5,contourFootprint);
 let coverage=(1.-smoothstep(.35,1.1,distance))*resolved*smoothstep(.0001,.001,contourFootprint)*select(0.,1.,level>=p.range.x&&level<=p.range.y);
 let linear=decodeSRGB(c);
 let luminance=dot(linear,vec3f(.2289746,.6917385,.0792869));
 let gain=mix(3.,2.,clamp(luminance,0.,1.));
 c=encodeSRGB(linear*mix(1.,gain,coverage));
}
if(!legend&&!validTerrain&&p.edgeRange.w<.5){c=select(vec3f(.012,.014,.016),vec3f(.014),p.range.z<.5);}
if(!legend&&water&&validTerrain&&p.edgeRange.w<.5){let background=select(vec3f(.012,.014,.016),vec3f(.014),p.range.z<.5);c=encodeSRGB(mix(decodeSRGB(background),decodeSRGB(c),1.-p.effects.w));}
if(!legend&&p.highlight.w>.5){
 let mask=textureLoad(mapMask,coord,0).rgb;
 var linear=decodeSRGB(c);
 let luminance=dot(linear,vec3f(.2289746,.6917385,.0792869));
 // Dark terrain gets 3x gain, tapering to 2x at linear SDR white (Y=1).
 // A modest luminance floor keeps roads legible over hidden water/nodata.
 let roadGain=mix(3.,2.,clamp(luminance,0.,1.));
 var road=mix(linear,vec3f(luminance),.5)*roadGain;
 road+=vec3f(max(0.,.08-luminance*roadGain));
 linear=mix(linear,road,mask.r);
 // Halve border light output in linear P3 while preserving its soft coverage.
 linear=mix(linear,mapInk()*.5,mask.g);
 // Label backgrounds and glyphs are composited after every map/terrain effect.
 linear=mix(linear,select(vec3f(.002,.004,.008),vec3f(.004),p.range.z<.5),mask.b);
 let label=textureLoad(mapLabels,coord,0);
 linear=mix(linear,mapInk(),label.a);c=encodeSRGB(linear);
}
if(!legend&&p.maskView.x>.5){c=encodeSRGB(decodeSRGB(c)*mix(1.,regionCoverage(o.position.xy),p.maskBounds.x));}
if(p.screen.w<.5){c=encodeSRGB(LINEAR_P3_TO_LINEAR_SRGB*decodeSRGB(c));}return vec4f(c,1);}`;
const regionVisibilityShader=colorShader+`
@fragment fn regionVisibility(o:Out)->@location(0) f32{return regionCoverage(o.position.xy);}`;
const reductionShader=`@group(0) @binding(0) var terrain:texture_2d<f32>;
@group(0) @binding(1) var<storage,read_write> results:array<vec2f>;
@group(0) @binding(2) var<uniform> options:vec4f;
@group(0) @binding(3) var regionVisibility:texture_2d<f32>;
var<workgroup> lows:array<f32,256>;var<workgroup> highs:array<f32,256>;
@compute @workgroup_size(256) fn reduce(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3u){let dims=textureDimensions(terrain);var lo=1e30;var hi=-1e30;for(var i=0u;i<16u;i++){let index=group.x*4096u+lane+i*256u;if(index<dims.x*dims.y){let sample=textureLoad(terrain,vec2i(i32(index%dims.x),i32(index/dims.x)),0);let v=sample.r;if(v>=-40000&&v<=40000&&!(options.x>.5&&sample.g< -1.)&&(options.y<.5||textureLoad(regionVisibility,vec2i(i32(index%dims.x),i32(index/dims.x)),0).r>.5)){lo=min(lo,v);hi=max(hi,v);}}}lows[lane]=lo;highs[lane]=hi;workgroupBarrier();for(var stride=128u;stride>0u;stride/=2u){if(lane<stride){lows[lane]=min(lows[lane],lows[lane+stride]);highs[lane]=max(highs[lane],highs[lane+stride]);}workgroupBarrier();}if(lane==0u){results[group.x]=vec2f(lows[0],highs[0]);}}`;
export async function createRenderer(device,format,context,legendContext,swatchContext=null){
 const layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float'}},{binding:1,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float'}},{binding:3,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float'}},{binding:4,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float'}},{binding:5,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float'}}]});const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
 async function make(code,vertex,fragment,target){const module=device.createShaderModule({code});const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(e=>e.message).join('\n'));return device.createRenderPipelineAsync({layout:pipelineLayout,vertex:{module,entryPoint:vertex},fragment:{module,entryPoint:fragment,targets:[{format:target}]},primitive:{topology:'triangle-list'}});}
 const heightPipeline=await make(heightShader,'tile','height','rg32float'),colorPipeline=await make(colorShader,'full','color',format);
 const exportPipeline=format==='rgba16float'?colorPipeline:await make(colorShader,'full','color','rgba16float');
 const regionVisibilityPipeline=await make(regionVisibilityShader,'full','regionVisibility','r8unorm');
 const imageryPass=await createImageryPass(device);
 const spherePass=await createSpherePass(device),mapPass=await createMapPass(device);let gpuMapActive=false;
 const reducePipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:device.createShaderModule({code:reductionShader}),entryPoint:'reduce'}});
 let maskTexture=device.createTexture({size:[1,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT}),maskWidth=1,maskHeight=1,maskRevision=-1;
 let labelTexture=device.createTexture({size:[1,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT}),labelWidth=1,labelHeight=1;
 let visibilityTexture=device.createTexture({size:[1,1],format:'r8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT}),visibilityWidth=1,visibilityHeight=1;
 let regionTexture=device.createTexture({size:[1,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT}),regionRevision=-1,regionBytes=4,regionUniforms=new Float32Array(24);
 let screen,screenView,w=0,h=0,uniforms=[],reductionBusy=false,heightDirty=true,edgesAvailable=false,captureRequest=null;
 function resize(width,height){if(width===w&&height===h)return;screen?.destroy();w=width;h=height;screen=device.createTexture({size:[w,h],format:'rg32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});screenView=screen.createView();heightDirty=true;}
 const regionTextures=new Map();
 let visibleElevationSpan=0,contourSpacing=0,contourEnabled=0,imageryEnabled=0;
 let imageryTexture=device.createTexture({size:[1,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
 function bind(texture,index,data){let u=uniforms[index];if(!u){u={buffer:device.createBuffer({size:192,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})};uniforms[index]=u;}if(u.texture!==texture||u.mask!==maskTexture||u.labels!==labelTexture||u.region!==regionTexture||u.imagery!==imageryTexture){u.texture=texture;u.mask=maskTexture;u.labels=labelTexture;u.region=regionTexture;u.imagery=imageryTexture;u.group=device.createBindGroup({layout,entries:[{binding:0,resource:texture.createView()},{binding:1,resource:{buffer:u.buffer}},{binding:2,resource:maskTexture.createView()},{binding:3,resource:labelTexture.createView()},{binding:4,resource:regionTexture.createView()},{binding:5,resource:imageryTexture.createView()}]});}device.queue.writeBuffer(u.buffer,0,new Float32Array([...data,...regionUniforms,visibleElevationSpan,contourSpacing,contourEnabled,imageryEnabled]));return u.group;}
 device.lost.then(info=>{captureRequest?.reject(new Error('GPU device lost during image capture: '+info.message));captureRequest=null;});
 return {clearTerrain(){spherePass.clear();mapPass.clear();heightDirty=true;},memoryBytes(cache){return imageryPass.bytes+regionBytes+visibilityWidth*visibilityHeight+w*h*24+maskWidth*maskHeight*4+labelWidth*labelHeight*4+spherePass.memoryBytes(cache);},capture(){
  if(captureRequest)return Promise.reject(new Error('An image capture is already queued.'));
  return new Promise((resolve,reject)=>{captureRequest={resolve,reject};});
 },invalidate(){heightDirty=true;},render({tiles,cache,dpr,canvas,legend,legendVertical=false,min,max,displayedElevationSpan=max-min,palette,contours=false,contourInterval=100,reversed=false,hdr,p3,selected=.5,selectedElevation=min+selected*(max-min),highlightWidth=(max-min)/8,emphasis,edges,noOcean,waterOpacity=noOcean?0:1,sphere=null,imagery=null,mapOverlay=null,regionMask=null,pinnedRegionRevision=null,regionFilter=!!regionMask,view=null,reduce,onExposure}){
 visibleElevationSpan=Math.max(0,displayedElevationSpan);contourSpacing=Math.max(.001,contourInterval);contourEnabled=Number(contours);
 if(edges>0.&&!edgesAvailable)heightDirty=true;
 edgesAvailable=edges>0.;
 resize(canvas.width,canvas.height);
 regionUniforms.fill(0);
 if(regionMask&&view){
  if(regionRevision!==regionMask.revision){
   let cached=regionTextures.get(regionMask.revision);
   if(!cached&&regionMask.image){
    const image=regionMask.image;
    const texture=device.createTexture({size:[image.width,image.height],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
    device.queue.copyExternalImageToTexture({source:image},{texture},[image.width,image.height]);
    cached={texture,bytes:image.width*image.height*4};
    regionTextures.set(regionMask.revision,cached);regionBytes+=cached.bytes;
    image.close();regionMask.image=null;
   }
   if(cached){regionTexture=cached.texture;regionRevision=regionMask.revision;}
   // Keep the pinned mask resident while previews replace one another.
   for(const [revision,entry] of regionTextures){
    if(regionTextures.size<=3)break;
    if(revision===pinnedRegionRevision||revision===regionRevision)continue;
    regionTextures.delete(revision);regionBytes-=entry.bytes;
    void device.queue.onSubmittedWorkDone().then(()=>entry.texture.destroy());
   }
  }
  const [left,top,spanX,spanY]=regionMask.bounds,reference=regionMask.reference,delta=view.x-reference;
  regionUniforms.set([1,sphere?1:0,sphere?sphere.radius:256*2**view.zoom*dpr,reference,regionMask.strength??1,top,spanX,spanY,delta-Math.floor(delta+.5),view.y-top,reference-left,top,...(sphere?.right??[0,0,0]),0,...(sphere?.up??[0,0,0]),0,...(sphere?.front??[0,0,0]),0]);
 }
 const encoder=device.createCommandEncoder();
 // Mode remains active while its tiles are pending or missing.
 imageryEnabled=Number(!!imagery);
 if(imageryEnabled)imageryTexture=imageryPass.draw(encoder,imagery,w,h);
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
 let index=0;const tail=[min,max,palette,hdr,w,h,0,p3,selected,Number(emphasis)||0,edges,noOcean?1:0,selectedElevation,highlightWidth,0,0];
 if(heightDirty&&sphere){spherePass.draw(encoder,screenView,{camera:sphere,tiles,cache,noOcean:false,edges:edges>0.});heightDirty=false;}
 if(heightDirty){const pass=encoder.beginRenderPass({colorAttachments:[{view:screenView,clearValue:{r:-1e30,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'}]});pass.setPipeline(heightPipeline);for(const t of tiles){const e=cache.get(t.sourceKey??t.key);if(e?.state==='ready'){pass.setBindGroup(0,bind(e.texture,index++,[t.left*dpr,t.top*dpr,t.size*dpr,t.size*dpr,...tail.slice(0,12),...(t.uv??[0,0,1]),t.sourceKey?1:0]));pass.draw(6);}}pass.end();heightDirty=false;}
 // Fixed slots for presentation avoid rebuilding bind groups as tile count changes.
 for(const [ctx,isLegend,slot] of [[context,false,0],[legendContext,true,1]]){const pass=encoder.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});pass.setPipeline(colorPipeline);pass.setBindGroup(0,bind(screen,tiles.length+slot,[0,0,0,0,min,max,palette,hdr,isLegend?legend.width:w,isLegend?legend.height:h,isLegend?(legendVertical?3:1):0,p3,selected,Number(emphasis)||0,edges,1-waterOpacity,selectedElevation,highlightWidth,reversed?1:0,!isLegend&&mapOverlay?1:0]));pass.draw(3);pass.end();}
 // A solid center-color preview uses the same HDR shader as the legend.
 if(swatchContext&&Number(emphasis)>0){
  const swatch=swatchContext.canvas;
  const pass=encoder.beginRenderPass({colorAttachments:[{view:swatchContext.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});
  pass.setPipeline(colorPipeline);
  pass.setBindGroup(0,bind(screen,tiles.length+3,[0,0,0,0,min,max,palette,hdr,swatch.width,swatch.height,2,p3,selected,Number(emphasis)||0,0,noOcean?1:0,selectedElevation,highlightWidth,reversed?1:0,0]));
  pass.draw(3);pass.end();
 }
 // Render an export-only float target, even if the visible canvas fell back to SDR.
 // This captures the same frame before presentation, without canvas.toBlob().
 let exportReadback,exportTexture,exportRequest;
 if(captureRequest){
  exportRequest=captureRequest;captureRequest=null;
  try{
   exportTexture=device.createTexture({size:[w,h],format:'rgba16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
   const pass=encoder.beginRenderPass({colorAttachments:[{view:exportTexture.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});
   pass.setPipeline(exportPipeline);
   pass.setBindGroup(0,bind(screen,tiles.length+2,[0,0,0,0,min,max,palette,hdr,w,h,0,p3,selected,Number(emphasis)||0,edges,1-waterOpacity,selectedElevation,highlightWidth,reversed?1:0,mapOverlay?1:0]));
   pass.draw(3);pass.end();
   exportReadback=captureTexture(device,encoder,exportTexture);
  }catch(error){exportTexture?.destroy();exportRequest.reject(error);}
 }
 if(reduce&&!reductionBusy&&regionFilter&&regionMask){
  if(visibilityWidth!==w||visibilityHeight!==h){visibilityTexture.destroy();visibilityWidth=w;visibilityHeight=h;visibilityTexture=device.createTexture({size:[w,h],format:'r8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT});}
  const pass=encoder.beginRenderPass({colorAttachments:[{view:visibilityTexture.createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'}]});
  pass.setPipeline(regionVisibilityPipeline);pass.setBindGroup(0,bind(screen,tiles.length+4,[0,0,0,0,min,max,palette,hdr,w,h,0,p3,selected,Number(emphasis)||0,edges,0,selectedElevation,highlightWidth,0,0]));pass.draw(3);pass.end();
 }
 let readback,output,groups,reductionOptions;if(reduce&&!reductionBusy){groups=Math.ceil(w*h/4096);reductionOptions=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(reductionOptions,0,new Float32Array([noOcean?1:0,regionFilter&&regionMask?1:0,0,0]));output=device.createBuffer({size:groups*8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});readback=device.createBuffer({size:groups*8,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const pass=encoder.beginComputePass();pass.setPipeline(reducePipeline);pass.setBindGroup(0,device.createBindGroup({layout:reducePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:screenView},{binding:1,resource:{buffer:output}},{binding:2,resource:{buffer:reductionOptions}},{binding:3,resource:visibilityTexture.createView()}]}));pass.dispatchWorkgroups(groups);pass.end();encoder.copyBufferToBuffer(output,0,readback,0,groups*8);reductionBusy=true;}
 device.queue.submit([encoder.finish()]);
 if(exportReadback)exportReadback.read().then(result=>exportRequest.resolve({...result,colorSpace:p3?'display-p3':'srgb'}),error=>exportRequest.reject(error)).finally(()=>exportTexture.destroy());
 if(readback){readback.mapAsync(GPUMapMode.READ).then(()=>{const values=new Float32Array(readback.getMappedRange());let lo=1e30,hi=-1e30;for(let i=0;i<values.length;i+=2){lo=Math.min(lo,values[i]);hi=Math.max(hi,values[i+1]);}readback.unmap();reductionBusy=false;onExposure(lo,hi);}).catch(error=>{reductionBusy=false;console.warn('Exposure readback failed',error);}).finally(()=>{readback.destroy();output.destroy();reductionOptions.destroy();});return true;}return false;
 }};
}
