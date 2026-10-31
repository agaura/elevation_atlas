import {trimTerrain} from './terrain-cache.js';
import {retryDelay} from './request-policy.js';
import {gebcoSampling} from './gebco.js';
import {setupRepeatButton} from './repeat-button.js';
import {setupCanvasGestures} from './canvas-gestures.js';
import {uploadTerrainTexture} from './terrain-gpu.js';
import {setupSearch,searchDestination} from './search.js';
import {MapOverlay} from './map-overlay.js';
import {probePosition,sampleProbe,projectProbe} from './probe.js';
import {SineTransition,ExposureTransition} from './exposure.js';
import {sphereCamera,sphereTiles,zoomSphereAt,maximumSphereZoom,boundedSphereY,panSphere} from './sphere.js';
import {elevationAt,defaultHighlightWidth} from './highlight.js';
import {coastStep} from './motion.js';
import {createRenderer} from './gpu.js';
import {sourceZoom,visibleTiles,wrap,minimumMapZoom,boundedMapY,maximumMapZoom} from './terrain.js';
const $=id=>document.getElementById(id), canvas=$('map'),legend=$('legend');
const view={x:.5,y:.42,zoom:2};
try{const saved=location.hash.slice(1).split('/').map(Number);if(saved.length===3&&saved.every(Number.isFinite)){view.zoom=Math.max(0,Math.min(22,saved[0]));view.x=wrap(saved[1],1);view.y=boundedSphereY(saved[2]);}}catch{}
let device,context,legendContext,renderer,format,toneMapping,colorSpace='display-p3',tiles=[],cache=new Map(),active=0,queue=[],frame=0,dpr=1,width=1,height=1,min=-11000,max=8850,metadata;
let sphereZoom=0,globeCamera=null;
const locks={min:false,max:false},exposureTargets={min,max},exposureTweens={min:new ExposureTransition(min),max:new ExposureTransition(max)},edgeTransition=new SineTransition(1);const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
const sliderDomain={min:new SineTransition(-12000),max:new SineTransition(9000)};let viewBounds={min:-12000,max:9000};
let highlightElevationLocked=true,highlightPosition=.5,pinnedElevation=null,previewElevation=null,hoverPosition=.5,highlightFraction=1/8,lockedHighlightWidth=null,hovering=false,highlightPreviewOnly=false,exposureDirty=true,exposureConfig=0,lastViewMotion=-Infinity,viewDirty=false;
const fallback={land:{tiles:['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'],tileSize:512,maxzoom:18},sea:{tiles:['https://tiles.openwaters.io/seascape/{z}/{x}/{y}.webp'],tileSize:512,maxzoom:18,schema:1}};
const mapOverlay=new MapOverlay(requestRender,message=>{$('map-status').textContent=message;});
function requestRender(){if(!frame)frame=requestAnimationFrame(time=>{frame=0;if(viewDirty){viewDirty=false;updateViewNow();}render(time);});}
function controls(){applySliderDomain();for(const id of ['min','max']){$(id+'-value').textContent=Math.round(id==='min'?min:max).toLocaleString()+' m';$(id).value=id==='min'?min:max;} $('legend-min').textContent=Math.round(min).toLocaleString()+' m';$('legend-max').textContent=Math.round(max).toLocaleString()+' m';syncNumbers();}
function reportGebco(){
 if(!metadata)return;
 const size=Math.max(metadata.land.tileSize||512,metadata.sea.tileSize||512),now=performance.now();
 const eligible=[...new Map(tiles.filter(t=>!t.fallback&&gebcoSampling(t,size).useGebco).map(t=>[t.key,t])).values()];
 let complete=0,loading=0,retrying=0;
 for(const t of eligible){
  const entry=cache.get(t.key);
  if(entry?.oceanSource==='gebco')complete++;
  else if(entry?.refineAbort&&!entry.refineAbort.signal.aborted)loading++;
  else if((entry?.refineAfter||0)>now)retrying++;
 }
 const queued=eligible.length-complete-loading-retrying;
 $('gebco-coverage').textContent=`${complete} / ${eligible.length}`;
 $('gebco-status').textContent=!eligible.length?'Seascape Only':complete===eligible.length?'Complete':
  [loading&&`${loading} Loading`,queued&&`${queued} Queued`,retrying&&`${retrying} Retrying`].filter(Boolean).join(' · ');
}
function report(){reportGebco();const ready=tiles.filter(t=>!!cache.get(t.key)?.texture).length;const missing=tiles.filter(t=>cache.get(t.key)?.state==='failed').length;const parents=tiles.filter(t=>cache.get(t.key)?.overzoomed).length;$('coverage').textContent=`${ready} / ${tiles.length}${parents?' ('+parents+' parent)':''}`;$('message').textContent=missing?`${missing} tile(s) unavailable. Retrying automatically…`:ready<tiles.length?'Loading native-resolution terrain…':$('water').checked&&tiles.some(t=>cache.get(t.key)?.refineAbort)?'Refining ocean detail…':'';}
const tileWorker=new Worker(new URL('./terrain.worker.js',import.meta.url),{type:'module'});
let nextRequest=0;const pendingTiles=new Map();
tileWorker.onmessage=({data})=>{const pending=pendingTiles.get(data.id);if(!pending)return;if(data.progress){pending.progress(data.timeout);return;}pendingTiles.delete(data.id);if(data.error)pending.reject(Object.assign(Error(data.error),{status:data.status,retryAfterMs:data.retryAfterMs||0}));else pending.resolve(data);};
function invalidateTerrain(){exposureDirty=true;renderer?.invalidate();}
// Keep recent CPU and GPU tiles under a shared allocation estimate. Mandatory
// visible tiles can exceed the target; optional history is evicted first.
const mobileBudget=matchMedia('(pointer: coarse)').matches;
const cacheBudget=(mobileBudget?256:512)*1024*1024;
function trimTerrainCache(){
 const needed=new Set(['0/0/0',...tiles.map(t=>t.key),...flatRenderTiles(true).map(t=>t.sourceKey??t.key)]);
 trimTerrain(cache,needed,{budget:cacheBudget,gpuBudget:(mobileBudget?48:128)*1024*1024,extraBytes:renderer?.memoryBytes?.(cache)||0});
}
function requestTerrain(t,signal,oceanSource,retry=false,timeouts=0){
 const id=++nextRequest;
 return new Promise((resolve,reject)=>{
  const cancel=()=>{tileWorker.postMessage({id,cancel:true});finish(Error('Tile cancelled'));};
  const finish=(error,data)=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);pendingTiles.delete(id);error?reject(error):resolve(data);};
  const timeout=(oceanSource==='gebco')?10000:1000*2**Math.min(timeouts,3);
  let timer;
  const progress=(inactivityTimeout=timeout)=>{clearTimeout(timer);timer=setTimeout(()=>{tileWorker.postMessage({id,cancel:true});finish(new DOMException('Tile request timed out','TimeoutError'));},inactivityTimeout);};
  progress();
  pendingTiles.set(id,{resolve:data=>finish(null,{...data,oceanSource:data.oceanSource??oceanSource}),reject:finish,progress});
  signal.addEventListener('abort',cancel,{once:true});
  if(signal.aborted){cancel();return;}
  tileWorker.postMessage({id,t,metadata,oceanSource,retry});
 });
}
function applyTerrain(entry,decoded){
 entry.texture?.destroy();delete entry.texture;
 const {size,values,overzoomed,oceanSource='seascape'}=decoded;
 Object.assign(entry,{size,values,overzoomed,oceanSource,state:'ready',bytes:values.byteLength});
 trimTerrainCache();invalidateTerrain();
}
async function load(t,entry){
 const decoded=await requestTerrain(t,entry.abort.signal,'seascape',entry.attempts>0,entry.timeouts||0);
 if(!entry.abort.signal.aborted)applyTerrain(entry,decoded);
}
// Refinements have their own single background slot. A slow GEBCO read never
// occupies a foreground slot or hides an already usable Seascape tile.
let refining=false,refinementTimer=0;
function pumpRefinements(){
 clearTimeout(refinementTimer);
 if(document.hidden||refining||active||queue.length||!metadata)return;
 const now=performance.now(),size=Math.max(metadata.land.tileSize||512,metadata.sea.tileSize||512);
 const candidates=tiles.filter(t=>!t.fallback&&gebcoSampling(t,size).useGebco)
  .map(t=>({t,entry:cache.get(t.key)}))
  .filter(({entry})=>entry?.state==='ready'&&entry.oceanSource!=='gebco');
 const candidate=candidates.find(({entry})=>(entry.refineAfter||0)<=now);
 if(!candidate){
  if(candidates.length)refinementTimer=setTimeout(pumpRefinements,Math.max(1,Math.min(...candidates.map(({entry})=>entry.refineAfter))-now));
  return;
 }
 const {t,entry}=candidate,controller=new AbortController();
 refining=true;entry.refineAbort=controller;report();
 requestTerrain(t,controller.signal,'gebco').then(decoded=>{
  if(controller.signal.aborted||cache.get(t.key)!==entry)return;
  applyTerrain(entry,decoded);requestRender();
 }).catch(error=>{
  if(!controller.signal.aborted){entry.refineAttempts=(entry.refineAttempts||0)+1;entry.refineAfter=performance.now()+retryDelay(error,entry.refineAttempts,Math.random,5000);console.warn('Ocean refinement',t.key,error);}
 }).finally(()=>{
  delete entry.refineAbort;refining=false;report();pumpRefinements();
 });
}
function pump(){if(document.hidden)return;while(active<(mobileBudget?3:4)&&queue.length){
 const t=queue.shift(),entry=cache.get(t.key);if(!entry||entry.state!=='queued')continue;
 entry.state='loading';active++;
 load(t,entry).catch(e=>{if(!entry.abort.signal.aborted){
  entry.state='failed';entry.attempts=(entry.attempts||0)+1;
  if(e.name==='TimeoutError')entry.timeouts=(entry.timeouts||0)+1;
  console.warn(t.key,e);
  const cancelRetry=()=>clearTimeout(timer);
  const timer=setTimeout(()=>{
   entry.abort.signal.removeEventListener('abort',cancelRetry);
   if(cache.get(t.key)!==entry||entry.abort.signal.aborted)return;
   entry.state='queued';queue.push(t);report();pump();
  },retryDelay(e,entry.attempts));
  entry.abort.signal.addEventListener('abort',cancelRetry,{once:true});
 }}).finally(()=>{active--;report();requestRender();pump();});
}pumpRefinements();}

// Safari rate-limits history writes. URL bookkeeping must never stop rendering.
let viewUrlTimer=0,lastViewUrlWrite=-Infinity,pendingViewUrl=null;
function syncViewUrl(url){
 pendingViewUrl=url;
 if(viewUrlTimer)return;
 function flush(){
  viewUrlTimer=0;
  const delay=lastViewUrlWrite+500-performance.now();
  if(delay>0){viewUrlTimer=setTimeout(flush,delay);return;}
  const latest=pendingViewUrl;pendingViewUrl=null;
  if(latest===null||latest===location.hash)return;
  lastViewUrlWrite=performance.now();
  try{history.replaceState(null,'',latest);}
  catch(error){
   // Keep the newest view and retry after a cooldown, outside the frame path.
   pendingViewUrl=latest;lastViewUrlWrite=performance.now()+29500;
   viewUrlTimer=setTimeout(flush,30000);
   console.warn('Could not update map URL; rendering will continue.',error);
  }
 }
 flush();
}
function updateView(){viewDirty=true;requestRender();}
function updateViewNow(){if(!device||!metadata)return;invalidateTerrain();dpr=window.devicePixelRatio||1;const rect=canvas.getBoundingClientRect();width=rect.width;height=rect.height;constrain();const pw=Math.max(1,Math.round(width*dpr)),ph=Math.max(1,Math.round(height*dpr));if(Math.max(pw,ph)>device.limits.maxTextureDimension2D){$('message').textContent='Viewport exceeds this GPU’s texture-size limit. Reduce window size.';return;}if(canvas.width!==pw)canvas.width=pw;if(canvas.height!==ph)canvas.height=ph;const lw=Math.max(1,Math.round(legend.clientWidth*dpr)),lh=Math.max(1,Math.round(legend.clientHeight*dpr));if(legend.width!==lw)legend.width=lw;if(legend.height!==lh)legend.height=lh;
 const maxzoom=Math.min(metadata.land.maxzoom??18,metadata.sea.maxzoom??18),tileSize=Math.min(metadata.land.tileSize||512,metadata.sea.tileSize||512);
 globeCamera=isSphere()?sphereCamera(view,width,height,dpr,sphereZoom):null;
 const z=sourceZoom(view.zoom,dpr,tileSize,maxzoom);tiles=globeCamera?sphereTiles(globeCamera,maxzoom,tileSize):visibleTiles(view,width,height,z);if(globeCamera&&!tiles.some(t=>t.z===0))tiles.unshift({z:0,x:0,y:0,key:'0/0/0',fallback:true});const requested=[...tiles].sort((a,b)=>Number(!!a.fallback)-Number(!!b.fallback));if(!requested.some(t=>t.z===0))requested.push({z:0,x:0,y:0,key:'0/0/0',fallback:true});const needed=new Set(requested.map(t=>t.key));queue=[];
 for(const [key,entry] of cache){if(!needed.has(key))entry.refineAbort?.abort();if(!needed.has(key)&&entry.state!=='ready'){entry.abort.abort();cache.delete(key);}}
 for(const t of requested){let entry=cache.get(t.key);if(!entry){entry={state:'queued',abort:new AbortController()};cache.set(t.key,entry);queue.push(t);}else if(entry.state==='queued'&&!queue.some(q=>q.key===t.key))queue.push(t);entry.used=performance.now();}
 trimTerrainCache();
 $('pixels').textContent=`${pw} × ${ph} / ${dpr}×`;$('level').textContent=globeCamera?`z${Math.min(...tiles.filter(t=>!t.fallback).map(t=>t.z))}–${Math.max(...tiles.filter(t=>!t.fallback).map(t=>t.z))} / sphere`:`z${z} / view ${view.zoom.toFixed(2)}`;const lat=Math.atan(Math.sinh(Math.PI*(1-2*view.y)))*180/Math.PI;$('scale').textContent=`${(globeCamera?6378137/globeCamera.radius:40075016.686*Math.cos(lat*Math.PI/180)/(256*2**view.zoom*dpr)).toFixed(2)} m / device px${globeCamera?' at center':''}`;syncViewUrl(`#${view.zoom.toFixed(4)}/${view.x.toFixed(7)}/${view.y.toFixed(7)}`);report();pump();}
function flatRenderTiles(uploadedOnly=false){const ready=e=>uploadedOnly?(e?.state==='ready'&&!!e.texture):e?.state==='ready';return tiles.flatMap(t=>{
 if(ready(cache.get(t.key)))return [t];
 for(let z=t.z-1;z>=0;z--){const factor=2**(t.z-z),x=Math.floor(t.x/factor),y=Math.floor(t.y/factor),sourceKey=`${z}/${wrap(x,2**z)}/${y}`;
  if(ready(cache.get(sourceKey)))return [{...t,sourceKey,uv:[wrap(t.x,factor)/factor,wrap(t.y,factor)/factor,1/factor]}];
 }return [];
});}
// Range domains move independently of the selected color limits. Expand just
// enough to retain selected values outside the view; native range inputs clamp otherwise.
function applySliderDomain(time=performance.now()){
 const lower=Math.min(sliderDomain.min.valueAt(time),min),upper=Math.max(sliderDomain.max.valueAt(time),max);
 for(const id of ['min','max']){const input=$(id);input.min=lower;input.max=upper;input.value=id==='min'?min:max;}
 syncNumbers();
}
function retargetSliderDomain(time=performance.now()){
 const automatic=$('auto-slider-range').checked;
 sliderDomain.min.retarget(automatic?viewBounds.min:-12000,time);
 sliderDomain.max.retarget(automatic?viewBounds.max:9000,time);
}
function advanceSliderDomain(time){
 if(reducedMotion.matches){sliderDomain.min.snap(sliderDomain.min.target);sliderDomain.max.snap(sliderDomain.max.target);}
 applySliderDomain(time);
 return sliderDomain.min.active(time)||sliderDomain.max.active(time);
}
function movingView(time){return pointers.size>0||momentumFrame!==0||navigationFrame!==0||time-lastViewMotion<100;}
function advanceExposure(time){
 const moving=movingView(time);
 if(reducedMotion.matches){exposureTweens.min.snap(exposureTargets.min);exposureTweens.max.snap(exposureTargets.max);}
 const nextMin=locks.min?min:exposureTweens.min.advance(time,moving),nextMax=locks.max?max:exposureTweens.max.advance(time,moving);
 if(nextMin!==min||nextMax!==max){min=nextMin;max=Math.max(nextMin+1/256,nextMax);controls();}
 return (!locks.min&&exposureTweens.min.active(time))||(!locks.max&&exposureTweens.max.active(time));
}
function retargetExposure(time){const moving=movingView(time);exposureTweens.min.retarget(exposureTargets.min,time,moving);exposureTweens.max.retarget(exposureTargets.max,time,moving);}
function render(time=performance.now()){
 if(!renderer||!metadata)return;const easing=advanceExposure(time),domainEasing=advanceSliderDomain(time);if(reducedMotion.matches)edgeTransition.snap($('edges').checked?1:0);highlightLabel();updateProbe();
 const mapMask=$('map-mode').checked?mapOverlay.draw({view,width,height,dpr,camera:globeCamera}):null;
 const revision=exposureConfig;let renderTiles=globeCamera?tiles:flatRenderTiles();
 const pendingExposure=exposureDirty&&(!locks.min||!locks.max||$('auto-slider-range').checked);
 const entries=[...new Set([cache.get('0/0/0'),...renderTiles.map(t=>cache.get(t.sourceKey??t.key))])].filter(e=>e?.state==='ready'&&!e.texture);
 const budget=movingView(time)?2:4;
 for(const entry of entries.slice(0,budget))uploadTerrainTexture(device,entry);
 if(entries.length){renderer.invalidate();exposureDirty=true;}
 if(entries.length>budget)requestRender();
 if(!globeCamera)renderTiles=flatRenderTiles(true);report();
 trimTerrainCache();
 const started=renderer.render({tiles:renderTiles,cache,dpr,canvas,legend,min,max,palette:Number($('palette').value),reversed:$('palette-flip').getAttribute('aria-pressed')==='true',hdr:toneMapping==='extended'?2:1,p3:colorSpace==='display-p3'?1:0,selectedElevation:activeElevation(),highlightWidth:activeWidth(),emphasis:hovering||$('highlight').checked,edges:edgeTransition.valueAt(time),noOcean:!$('water').checked,sphere:globeCamera,mapOverlay:mapMask,reduce:pendingExposure,onExposure(lo,hi){
  if(revision===exposureConfig&&lo<=hi){
   const now=performance.now();advanceExposure(now);
   viewBounds={min:lo,max:Math.max(lo+1/256,hi)};retargetSliderDomain(now);
   const minLocked=locks.min,maxLocked=locks.max;
   if(!minLocked&&!maxLocked){exposureTargets.min=lo;exposureTargets.max=Math.max(lo+1/256,hi);}
   else if(!minLocked)exposureTargets.min=Math.min(lo,max-1/256);
   else if(!maxLocked)exposureTargets.max=Math.max(min+1/256,hi);
   retargetExposure(now);controls();requestRender();
  }else if(exposureDirty)requestRender();
 }});
 if(started)exposureDirty=false;if(easing||domainEasing||edgeTransition.active(time))requestRender();
}
async function init(){if(!navigator.gpu)throw Error('WebGPU is unavailable. Open in a WebGPU browser on localhost or HTTPS.');const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('No WebGPU adapter available.');device=await adapter.requestDevice({requiredLimits:{maxTextureDimension2D:adapter.limits.maxTextureDimension2D,maxTextureArrayLayers:adapter.limits.maxTextureArrayLayers}});device.lost.then(info=>{$('message').textContent='GPU device lost: '+info.message+'. Reload to reconnect.';});device.addEventListener('uncapturederror',e=>{$('message').textContent=e.error.message;console.error(e.error);});context=canvas.getContext('webgpu');legendContext=legend.getContext('webgpu');let configured=false;for(const candidate of ['rgba16float',navigator.gpu.getPreferredCanvasFormat()]){for(const mode of ['extended','standard']){try{for(const ctx of [context,legendContext])ctx.configure({device,format:candidate,colorSpace,alphaMode:'opaque',toneMapping:{mode}});format=candidate;toneMapping=mode;configured=true;break;}catch{}}if(configured)break;}if(!configured){colorSpace='srgb';format=navigator.gpu.getPreferredCanvasFormat();toneMapping='standard';for(const ctx of [context,legendContext])ctx.configure({device,format,alphaMode:'opaque'});}
 $('hdr').textContent=`${toneMapping==='extended'?'HDR':'SDR'} / ${colorSpace==='display-p3'?'P3':'sRGB'}`;renderer=await createRenderer(device,format,context,legendContext);
 const meta=await Promise.allSettled(['https://tiles.mapterhorn.com/tilejson.json','https://tiles.openwaters.io/seascape/raster.json'].map(async url=>{const r=await fetch(url);if(!r.ok)throw Error(r.status);return r.json();}));metadata={land:meta[0].status==='fulfilled'?meta[0].value:fallback.land,sea:meta[1].status==='fulfilled'?meta[1].value:fallback.sea};if(metadata.sea.schema!==1)throw Error('Unsupported Seascape schema. Expected version 1.');controls();highlightLabel();downloadButtons.forEach(button=>{button.disabled=false;});new ResizeObserver(updateView).observe(canvas);window.addEventListener('resize',updateView);let currentDpr=window.devicePixelRatio;setInterval(()=>{if(currentDpr!==window.devicePixelRatio){currentDpr=window.devicePixelRatio;updateView();}},500);updateView();}
function setControlExpansion(id,open){const element=$(id);if(element.dataset.open===String(open))return;element.dataset.open=String(open);element.inert=!open;element.setAttribute('aria-hidden',String(!open));}
function syncColorRangeMode(){const automatic=!locks.min&&!locks.max;$('auto-color-range').checked=automatic;setControlExpansion('elevation-range-controls',!automatic);}
function setLocked(id,locked){locks[id]=locked;const button=$(id+'-lock'),label=`${locked?'Unlock':'Lock'} ${id==='min'?'minimum':'maximum'} elevation`;button.setAttribute('aria-pressed',locked);button.setAttribute('aria-label',label);button.title=`${locked?'Resume':'Pause'} automatic ${id==='min'?'minimum':'maximum'} elevation adjustment`;$(id).closest('.slider-control').classList.toggle('is-locked',locked);if(locked){exposureTargets[id]=id==='min'?min:max;exposureTweens[id].snap(exposureTargets[id]);}syncColorRangeMode();}
$('auto-color-range').addEventListener('change',()=>{
 const automatic=$('auto-color-range').checked;
 advanceExposure(performance.now());exposureConfig++;
 setLocked('min',!automatic);setLocked('max',!automatic);
 invalidateTerrain();controls();requestRender();
});
$('auto-slider-range').addEventListener('change',()=>{retargetSliderDomain();if($('auto-slider-range').checked)invalidateTerrain();requestRender();});
for(const id of ['min','max']){
 $(id).addEventListener('input',()=>{
  if(id==='min'){min=Math.min(Number($('min').value),max-1);exposureTargets.max=Math.max(exposureTargets.max,min+1/256);}else{max=Math.max(Number($('max').value),min+1);exposureTargets.min=Math.min(exposureTargets.min,max-1/256);}

  setLocked(id,true);const other=id==='min'?'max':'min';if(exposureTweens[other].target!==exposureTargets[other])exposureTweens[other].start(other==='min'?min:max,exposureTargets[other],performance.now());controls();requestRender();
 });
 $(id+'-lock').addEventListener('click',()=>{setLocked(id,!locks[id]);exposureDirty=true;controls();requestRender();});
}
$('water').addEventListener('change',()=>{report();exposureConfig++;invalidateTerrain();requestRender();});
$('edges').addEventListener('change',()=>{edgeTransition.retarget($('edges').checked?1:0,performance.now());requestRender();});
const meters=value=>value.toLocaleString(undefined,{maximumFractionDigits:3})+' m';
function activeElevation(){return hovering&&previewElevation!==null?previewElevation:highlightElevationLocked?(pinnedElevation??elevationAt(.5,min,max)):elevationAt(highlightPosition,min,max);}
function selectHighlightElevation(elevation){pinnedElevation=elevation;highlightPosition=(elevation-min)/(max-min);}
function activeWidth(){return lockedHighlightWidth??defaultHighlightWidth(min,max,highlightFraction);}
function initializeHighlight(){if(pinnedElevation===null)selectHighlightElevation(elevationAt(.5,min,max));}
function highlightLabel(){
 if(hovering)previewElevation=elevationAt(hoverPosition,min,max);
 const elevation=activeElevation(),halfWidth=activeWidth(),active=hovering||$('highlight').checked;
 legend.setAttribute('aria-valuemin',Math.min(min,elevation));legend.setAttribute('aria-valuemax',Math.max(max,elevation));legend.setAttribute('aria-valuenow',elevation);legend.setAttribute('aria-valuetext',meters(elevation));
 $('highlight-value').textContent=meters(elevation);
 $('highlight-value').dataset.elevation=elevation;
 const hoverLabel=$('legend-hover');hoverLabel.hidden=!active;
 hoverLabel.style.setProperty('--position',Math.max(0,Math.min(1,(elevation-min)/(max-min)))*100);
 // Clamp the text itself, rather than a fixed-width box, to the color bar.
 if(active)hoverLabel.style.setProperty('--label-width',`${$('highlight-value').getBoundingClientRect().width}px`);
 // Keep endpoint readings unless they collide with the selected elevation text.
 const centerBounds=active?$('highlight-value').getBoundingClientRect():null;
 for(const id of ['legend-min','legend-max']){
  const endpoint=$(id),bounds=endpoint.getBoundingClientRect();
  endpoint.style.visibility=centerBounds&&bounds.right+6>centerBounds.left&&bounds.left-6<centerBounds.right?'hidden':'';
 }

 setControlExpansion('highlight-panel',active);
 $('highlight-controls').disabled=!active;const elevationControl=$('highlight-elevation');elevationControl.value=elevation;
 const widthControl=$('highlight-width');widthControl.min=Math.min((max-min)*.000001,halfWidth);widthControl.max=Math.max(max-min,halfWidth);widthControl.value=halfWidth;syncNumbers();
}
function previewHighlight(event){if(!hovering&&!$('highlight').checked){highlightPreviewOnly=true;$('highlight').checked=true;}const rect=legend.getBoundingClientRect(),position=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));hoverPosition=position;previewElevation=elevationAt(position,min,max);hovering=true;highlightLabel();requestRender();}
// Keep iOS long presses on the color bar inside our pointer interaction.
for(const type of ['contextmenu','selectstart','dragstart'])legend.addEventListener(type,event=>event.preventDefault());
legend.addEventListener('touchstart',event=>event.preventDefault(),{passive:false});
legend.addEventListener('pointerenter',previewHighlight);legend.addEventListener('pointermove',previewHighlight);
legend.addEventListener('pointerdown',event=>{if(event.pointerType!=='mouse')event.preventDefault();legend.setPointerCapture(event.pointerId);previewHighlight(event);selectHighlightElevation(previewElevation);highlightPreviewOnly=false;$('highlight').checked=true;});
legend.addEventListener('pointerup',event=>{previewHighlight(event);selectHighlightElevation(previewElevation);if(event.pointerType!=='mouse'){hovering=false;highlightLabel();requestRender();}});
function endHighlightPreview(){hovering=false;if(highlightPreviewOnly)$('highlight').checked=false;highlightPreviewOnly=false;highlightLabel();requestRender();}
for(const event of ['pointerleave','pointercancel'])legend.addEventListener(event,endHighlightPreview);
$('highlight').addEventListener('change',()=>{highlightPreviewOnly=false;if($('highlight').checked)initializeHighlight();hovering=false;highlightLabel();requestRender();});
$('highlight-elevation').addEventListener('input',()=>{selectHighlightElevation(Number($('highlight-elevation').value));hovering=false;highlightLabel();requestRender();});
$('highlight-elevation-lock').addEventListener('click',()=>{
 const elevation=activeElevation();highlightElevationLocked=!highlightElevationLocked;
 selectHighlightElevation(elevation);hovering=false;
 const button=$('highlight-elevation-lock'),label=`${highlightElevationLocked?'Unlock':'Lock'} highlight elevation`;
 button.setAttribute('aria-pressed',highlightElevationLocked);button.setAttribute('aria-label',label);button.title=label;
 button.closest('.slider-control').classList.toggle('is-locked',highlightElevationLocked);
 highlightLabel();requestRender();
});
$('highlight-width').addEventListener('input' ,()=>{const value=Number($('highlight-width').value);if(lockedHighlightWidth!==null)lockedHighlightWidth=value;else highlightFraction=value/(max-min);highlightLabel();requestRender();});
$('highlight-width-lock').addEventListener('click',()=>{
 const width=activeWidth(),locked=lockedHighlightWidth===null;
 lockedHighlightWidth=locked?width:null;
 if(!locked)highlightFraction=width/(max-min);
 const button=$('highlight-width-lock'),label=`${locked?'Unlock':'Lock'} highlight half-width`;
 button.setAttribute('aria-pressed',locked);button.setAttribute('aria-label',label);button.title=label;
 button.closest('.slider-control').classList.toggle('is-locked',locked);
 highlightLabel();requestRender();
});
legend.addEventListener('keydown',event=>{
 if(event.key==='Escape'){highlightPreviewOnly=false;$('highlight').checked=false;hovering=false;}
 else if(['ArrowLeft','ArrowRight','Home','End','Enter',' '].includes(event.key)){
  initializeHighlight();const step=(max-min)*.01;let elevation=activeElevation();
  if(event.key==='ArrowLeft')elevation-=step;if(event.key==='ArrowRight')elevation+=step;if(event.key==='Home')elevation=min;if(event.key==='End')elevation=max;
  selectHighlightElevation(elevation);
  highlightPreviewOnly=false;$('highlight').checked=true;hovering=false;
 }else return;event.preventDefault();highlightLabel();requestRender();
});
$('palette').addEventListener('change',requestRender);
$('map-mode').addEventListener('change',()=>{mapOverlay.enable($('map-mode').checked);requestRender();});
$('palette-flip').addEventListener('click',()=>{const button=$('palette-flip');button.setAttribute('aria-pressed',button.getAttribute('aria-pressed')!=='true');requestRender();});
const sliderIds=['min','max','highlight-elevation','highlight-width'];
function syncNumbers(){for(const id of sliderIds){const range=$(id),number=$(id+'-number');if(!number)continue;number.min=range.min;number.max=range.max;number.disabled=range.disabled||Boolean(range.closest('fieldset')?.disabled);if(document.activeElement!==number)number.value=String(Number(Number(range.value).toPrecision(6)));}}
for(const id of sliderIds){const range=$(id),number=$(id+'-number');number.addEventListener('input',()=>{if(number.value===''||!Number.isFinite(number.valueAsNumber))return;range.value=Math.min(Number(range.max),Math.max(Number(range.min),number.valueAsNumber));range.dispatchEvent(new Event('input'));});number.addEventListener('change',()=>{number.value=range.value;});}
for(const button of document.querySelectorAll('[data-step-slider]'))setupRepeatButton(button,()=>{const range=$(button.dataset.stepSlider),step=range.step==='any'?1:Number(range.step);range.value=Number(range.value)+Number(button.dataset.stepDir)*step;range.dispatchEvent(new Event('input'));});
const downloadButtons=[$('download'),$('fullscreen-download')];
let exportBusy=false,exportMessageTimer=0;
async function downloadImage(){
 if(!renderer||!metadata||exportBusy)return;
 exportBusy=true;clearTimeout(exportMessageTimer);
 const status=$('export-status');
 downloadButtons.forEach(button=>{button.disabled=true;button.setAttribute('aria-busy','true');});status.textContent='Capturing full-resolution HDR…';
 let worker;
 try{
  stopMomentum();stopNavigation();
  const framePromise=renderer.capture();requestRender();
  const frame=await framePromise;
  const paletteName=$('palette').selectedOptions[0].textContent.toLowerCase().replace(/[^a-z0-9]+/g,'-');
  const filename=`elevation-atlas-${paletteName}-${frame.width}x${frame.height}-hdr.avif`;
  worker=new Worker(new URL('./image-export.worker.js',import.meta.url),{type:'module'});
  const encoded=await new Promise((resolve,reject)=>{
   worker.onmessage=({data})=>{if(data.status){status.textContent=data.status;return;}if(data.error)reject(new Error(data.error));else resolve(data);};
   worker.onerror=event=>reject(new Error(event.message||'The image encoder could not load.'));
   worker.postMessage(frame,[frame.pixels.buffer]);
  });
  const url=URL.createObjectURL(new Blob([encoded.bytes],{type:'image/avif'}));
  const link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  status.textContent=encoded.clipped?'HDR AVIF saved · some colors exceeded the PQ range':'HDR AVIF saved';
 }catch(error){status.textContent='Export failed: '+error.message;console.error(error);}
 finally{
  worker?.terminate();exportBusy=false;downloadButtons.forEach(button=>{button.disabled=false;button.removeAttribute('aria-busy');});
  exportMessageTimer=setTimeout(()=>{status.textContent='';},8000);
 }
}
for(const button of downloadButtons)button.addEventListener('click',downloadImage);
const panel=$('map-panel');
function fullscreenState(){const active=document.fullscreenElement===panel||panel.classList.contains('is-expanded');$('fullscreen').setAttribute('aria-pressed',active);$('fullscreen').setAttribute('aria-label',active?'Exit fullscreen':'Enter fullscreen');$('fullscreen').title=active?'Exit fullscreen':'Enter fullscreen';document.body.classList.toggle('canvas-fullscreen',active);$('fullscreen-exit').hidden=!active;$('fullscreen-download').hidden=!active;updateView();}
$('fullscreen').addEventListener('click',async()=>{
 if(document.fullscreenElement===panel||panel.classList.contains('is-expanded'))return;
 try{if(!panel.requestFullscreen)throw Error();await panel.requestFullscreen();}catch{panel.classList.add('is-expanded');}
 fullscreenState();canvas.focus({preventScroll:true});
});
document.addEventListener('fullscreenchange',fullscreenState);
async function exitFullscreen(){
 const active=document.fullscreenElement===panel||panel.classList.contains('is-expanded');
 stopMomentum();stopNavigation();if(!active)return;
 if(document.fullscreenElement===panel)await document.exitFullscreen().catch(()=>{});
 if(panel.classList.contains('is-expanded')){panel.classList.remove('is-expanded');fullscreenState();}
 canvas.focus({preventScroll:true});
}
$('fullscreen-exit').addEventListener('click',exitFullscreen);
window.addEventListener('keydown',event=>{if(event.key==='Escape')exitFullscreen();});
function isSphere(){return $('projection').checked;}
$('projection').addEventListener('change',()=>{exposureConfig++;stopMomentum();$('projection-label').textContent=isSphere()?'GLOBAL ELEVATION / SPHERE':'GLOBAL ELEVATION / WEB MERCATOR';updateView();});
function panBy(dx,dy){lastViewMotion=performance.now();
 if(isSphere()){const radius=Math.min(width,height)*.46*2**sphereZoom;Object.assign(view,panSphere(view,dx,dy,radius));}
 else{const scale=256*2**view.zoom;view.x-=dx/scale;view.y-=dy/scale;}
 const requestedY=view.y;constrain();return requestedY!==view.y;
}
setupSearch(location=>{
 stopMomentum();stopNavigation();
 const rect=canvas.getBoundingClientRect(),destination=searchDestination(location,rect.width,rect.height);
 view.x=destination.x;view.y=destination.y;view.zoom=destination.zoom;sphereZoom=destination.sphereZoom;
 constrain();updateView();canvas.focus({preventScroll:true});
});
function zoomCeiling(){return maximumMapZoom(Object.values(metadata??fallback));}
function constrain(){view.x=wrap(view.x,1);view.zoom=Math.max(minimumMapZoom(height),Math.min(zoomCeiling(),view.zoom));sphereZoom=Math.max(-1,Math.min(maximumSphereZoom(width,height,zoomCeiling()),sphereZoom));if(isSphere())view.y=boundedSphereY(view.y);else{view.y=boundedMapY(view.y,view.zoom,height);}}
function zoomAt(delta,x,y){lastViewMotion=performance.now();if(isSphere()){const nextZoom=Math.max(-1,Math.min(maximumSphereZoom(width,height,zoomCeiling()),sphereZoom+delta)),anchor=zoomSphereAt(view,width,height,sphereZoom,nextZoom,x,y);view.x=anchor.x;view.y=anchor.y;sphereZoom=nextZoom;updateView();return;}const old=256*2**view.zoom;view.zoom=Math.max(minimumMapZoom(height),Math.min(zoomCeiling(),view.zoom+delta));const next=256*2**view.zoom;view.x+=x/old-x/next;view.y+=y/old-y/next;constrain();updateView();}
canvas.addEventListener('wheel',e=>{stopMomentum();stopNavigation();e.preventDefault();const r=canvas.getBoundingClientRect();zoomAt(-e.deltaY*(e.deltaMode===1?.04:.004),e.clientX-r.left-width/2,e.clientY-r.top-height/2);},{passive:false});
const pointers=new Map();let gesture,lastMove=0,velocityX=0,velocityY=0,momentumFrame=0;
function stopMomentum(){cancelAnimationFrame(momentumFrame);momentumFrame=0;velocityX=velocityY=0;}
function startMomentum(){
 if(matchMedia('(prefers-reduced-motion: reduce)').matches||performance.now()-lastMove>80)return;
 velocityX*=.65;velocityY*=.65;let previous=performance.now();
 function tick(time){const dt=Math.min(32,Math.max(0,time-previous));previous=time;
 const step=coastStep(velocityX,velocityY,dt);velocityX=step.vx;velocityY=step.vy;
 if(panBy(step.dx,step.dy))velocityY=0;
 constrain();updateView();if(Math.hypot(velocityX,velocityY)>.02)momentumFrame=requestAnimationFrame(tick);else stopMomentum();
 }if(Math.hypot(velocityX,velocityY)>.02)momentumFrame=requestAnimationFrame(tick);
}
function snapshot(){const pts=[...pointers.values()];const center={x:pts.reduce((s,p)=>s+p.x,0)/pts.length,y:pts.reduce((s,p)=>s+p.y,0)/pts.length};return {...center,distance:pts.length>1?Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y):0};}
canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;stopMomentum();stopNavigation();canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});gesture=snapshot();lastMove=performance.now();});
canvas.addEventListener('pointermove',e=>{
 cursor={x:e.clientX,y:e.clientY,inside:e.pointerType==='mouse'&&matchMedia('(any-hover: hover)').matches};requestProbeUpdate();
 if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const next=snapshot(),s=256*2**view.zoom,now=performance.now(),dt=Math.max(1,now-lastMove),dx=next.x-gesture.x,dy=next.y-gesture.y;
 panBy(dx,dy);
 if(pointers.size===1){const mix=1-Math.exp(-dt/25);velocityX+=(Math.max(-2.5,Math.min(2.5,dx/dt))-velocityX)*mix;velocityY+=(Math.max(-2.5,Math.min(2.5,dy/dt))-velocityY)*mix;}else velocityX=velocityY=0;
 if(next.distance&&gesture.distance){const r=canvas.getBoundingClientRect();zoomAt(Math.log2(next.distance/gesture.distance),next.x-r.left-width/2,next.y-r.top-height/2);}else{constrain();updateView();}gesture=next;lastMove=now;
});
for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,e=>{if(!pointers.has(e.pointerId))return;const single=pointers.size===1;pointers.delete(e.pointerId);gesture=pointers.size?snapshot():null;if(event==='pointerup'&&single)startMomentum();else stopMomentum();lastMove=pointers.size?performance.now():lastMove;});
window.addEventListener('blur',stopMomentum);document.addEventListener('visibilitychange',()=>{if(document.hidden)stopMomentum();});
let cursor={x:0,y:0,inside:false},navigationFrame=0,navigationTime=0,navX=0,navY=0,navZoom=0;
const heldKeys=new Map(),tapUntil=new Map();
let pinnedProbe=null,probeFrame=0;
function requestProbeUpdate(){if(!probeFrame)probeFrame=requestAnimationFrame(()=>{probeFrame=0;updateProbe();});}
function cursorPoint(){
 if(!cursor.inside)return null;
 const rect=canvas.getBoundingClientRect(),x=cursor.x-rect.left,y=cursor.y-rect.top;
 if(x<0||y<0||x>rect.width||y>rect.height)return null;
 return probePosition(view,width,height,sphereZoom,x-width/2,y-height/2,isSphere());
}
function showProbe(point,positionId,elevationId){
 const position=$(positionId),elevation=$(elevationId);
 if(!point){position.textContent='—';elevation.textContent='—';return;}
 const sample=sampleProbe(cache,point,Math.max(metadata?.land.maxzoom??18,metadata?.sea.maxzoom??18));
 const lon=point.x*360-180,lat=Math.atan(Math.sinh(Math.PI*(1-2*point.y)))*180/Math.PI;
 position.textContent=`${Math.abs(lat).toFixed(5)}°${lat>=0?'N':'S'} ${Math.abs(lon).toFixed(5)}°${lon>=0?'E':'W'}`;
 elevation.textContent=sample?.elevation!=null?`${meters(sample.elevation)}${sample.water?' · water':''}`:sample?'No elevation data':'Loading elevation…';
}
function updateProbe(){
 const point=matchMedia('(any-hover: hover)').matches?cursorPoint():null;
 $('probe-status').closest('.probe-heading').hidden=!pinnedProbe;
 showProbe(point,'position','cursor-elevation');
 $('cursor-readout').hidden=!point;
 $('pinned-readout').hidden=!pinnedProbe;
 $('canvas-probe').hidden=!point&&!pinnedProbe;
 showProbe(pinnedProbe,'pinned-position','pinned-elevation');
 $('probe-unpin').hidden=!pinnedProbe;
 const marker=$('location-pin');marker.classList.toggle('grayscale',Number($('palette').value)===0);const screen=projectProbe(pinnedProbe,view,width,height,sphereZoom,isSphere());
 marker.toggleAttribute('hidden',!screen);
 if(screen){marker.style.left=`${screen.x}px`;marker.style.top=`${screen.y}px`;}

}
setupCanvasGestures(canvas,{
 stop:stopMomentum,
 zoom(x,y){stopMomentum();stopNavigation();const r=canvas.getBoundingClientRect();zoomAt(1,x-r.left-width/2,y-r.top-height/2);},
 pin(x,y){stopMomentum();stopNavigation();cursor={x,y,inside:true};const point=cursorPoint();cursor.inside=matchMedia('(any-hover: hover)').matches;if(point){pinnedProbe=point;requestProbeUpdate();}}
});
$('probe-unpin').addEventListener('click',()=>{pinnedProbe=null;requestProbeUpdate();});

canvas.addEventListener('pointerenter',event=>{cursor={x:event.clientX,y:event.clientY,inside:event.pointerType==='mouse'&&matchMedia('(any-hover: hover)').matches};requestProbeUpdate();});canvas.addEventListener('pointerleave',()=>{cursor.inside=false;requestProbeUpdate();});
const keyAction=code=>({ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',ArrowUp:'up',KeyW:'up',ArrowDown:'down',KeyS:'down',Equal:'in',NumpadAdd:'in',Minus:'out',NumpadSubtract:'out'})[code];
function stopNavigation(){cancelAnimationFrame(navigationFrame);navigationFrame=0;heldKeys.clear();tapUntil.clear();navX=navY=navZoom=0;}
function navigationTick(time){
 const dt=Math.min(40,Math.max(0,time-navigationTime));navigationTime=time;
 for(const [action,until] of tapUntil)if(time>=until)tapUntil.delete(action);
 const active=new Set([...heldKeys.values()].map(item=>item.action).concat([...tapUntil.keys()]));
 let x=Number(active.has('left'))-Number(active.has('right')),y=Number(active.has('up'))-Number(active.has('down'));const length=Math.hypot(x,y);if(length>1){x/=length;y/=length;}
 const blend=1-Math.exp(-dt/65);navX+=(x*720-navX)*blend;navY+=(y*720-navY)*blend;navZoom+=((Number(active.has('in'))-Number(active.has('out')))*1.5-navZoom)*blend;
 if(Math.hypot(navX,navY)>.1)panBy(navX*dt/1000,navY*dt/1000);
 if(Math.abs(navZoom)>.0005){const rect=canvas.getBoundingClientRect();zoomAt(navZoom*dt/1000,cursor.inside?cursor.x-rect.left-width/2:0,cursor.inside?cursor.y-rect.top-height/2:0);}else updateView();
 if(active.size||Math.hypot(navX,navY)>.1||Math.abs(navZoom)>.0005)navigationFrame=requestAnimationFrame(navigationTick);else stopNavigation();
}
window.addEventListener('keydown',event=>{
 const action=keyAction(event.code);if(!action||event.ctrlKey||event.metaKey||event.altKey||event.target.closest?.('input,textarea,select,button,[contenteditable="true"]'))return;
 event.preventDefault();if(heldKeys.has(event.code))return;stopMomentum();heldKeys.set(event.code,{action,start:performance.now()});if(!navigationFrame){navigationTime=performance.now();navigationFrame=requestAnimationFrame(navigationTick);}
});
window.addEventListener('keyup',event=>{const key=heldKeys.get(event.code);if(!key)return;heldKeys.delete(event.code);if(performance.now()<key.start+90)tapUntil.set(key.action,key.start+90);});
document.addEventListener('focusin',event=>{if(event.target.closest?.('input,textarea,select,button,[contenteditable="true"]'))stopNavigation();});
window.addEventListener('blur',stopNavigation);document.addEventListener('visibilitychange',()=>{if(document.hidden)stopNavigation();});
init().catch(e=>{$('message').textContent=e.message;console.error(e);});

// Finish existing foreground transfers, but start no new work in a hidden tab.
// Shared GEBCO ranges already downloading may finish and populate the cache.
document.addEventListener('visibilitychange',()=>{
 tileWorker.postMessage({pauseBackground:document.hidden});
 if(document.hidden){clearTimeout(refinementTimer);for(const entry of cache.values())entry.refineAbort?.abort();}
 else {mapOverlay.dirty=true;mapOverlay.pump();pump();requestRender();}
});
