import {SineTransition,ExposureTransition} from './exposure.js';
import {sphereCamera,sphereTiles,zoomSphereAt,maximumSphereZoom} from './sphere.js';
import {elevationAt,defaultHighlightWidth} from './highlight.js';
import {coastStep} from './motion.js';
import {createRenderer} from './gpu.js';
import {sourceZoom,visibleTiles,wrap,minimumMapZoom,boundedMapY,maximumMapZoom} from './terrain.js';
const $=id=>document.getElementById(id), canvas=$('map'),legend=$('legend');
const view={x:.5,y:.42,zoom:2};
try{const saved=location.hash.slice(1).split('/').map(Number);if(saved.length===3&&saved.every(Number.isFinite)){view.zoom=Math.max(0,Math.min(22,saved[0]));view.x=wrap(saved[1],1);view.y=Math.max(0,Math.min(1,saved[2]));}}catch{}
let device,context,legendContext,renderer,format,toneMapping,colorSpace='display-p3',tiles=[],cache=new Map(),active=0,queue=[],frame=0,dpr=1,width=1,height=1,min=-11000,max=8850,metadata;
let sphereZoom=0,globeCamera=null;
const locks={min:false,max:false},exposureTargets={min,max},exposureTweens={min:new ExposureTransition(min),max:new ExposureTransition(max)},edgeTransition=new SineTransition(1);const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
let pinnedElevation=null,previewElevation=null,hoverPosition=.5,highlightFraction=1/8,lockedHighlightWidth=null,hovering=false,exposureDirty=true,exposureConfig=0,lastViewMotion=-Infinity,viewDirty=false;
const fallback={land:{tiles:['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'],tileSize:512,maxzoom:18},sea:{tiles:['https://tiles.openwaters.io/seascape/{z}/{x}/{y}.webp'],tileSize:512,maxzoom:18,schema:1}};
function requestRender(){if(!frame)frame=requestAnimationFrame(time=>{frame=0;if(viewDirty){viewDirty=false;updateViewNow();}render(time);});}
function controls(){for(const id of ['min','max']){$(id+'-value').textContent=Math.round(id==='min'?min:max).toLocaleString()+' m';$(id).value=id==='min'?min:max;} $('legend-min').textContent=Math.round(min).toLocaleString()+' m';$('legend-max').textContent=Math.round(max).toLocaleString()+' m';syncNumbers();}
function report(){const ready=tiles.filter(t=>cache.get(t.key)?.state==='ready').length;const missing=tiles.filter(t=>cache.get(t.key)?.state==='failed').length;const parents=tiles.filter(t=>cache.get(t.key)?.overzoomed).length;$('coverage').textContent=`${ready} / ${tiles.length}${parents?' ('+parents+' parent)':''}`;$('message').textContent=missing?`${missing} tile(s) unavailable. Retrying automatically…`:ready<tiles.length?'Loading native-resolution terrain…':'';}
const tileWorker=new Worker(new URL('./terrain.worker.js',import.meta.url),{type:'module'});
let nextRequest=0;const pendingTiles=new Map();
tileWorker.onmessage=({data})=>{const pending=pendingTiles.get(data.id);if(!pending)return;pendingTiles.delete(data.id);if(data.error)pending.reject(Error(data.error));else pending.resolve(data);};
function invalidateTerrain(){exposureDirty=true;renderer?.invalidate();}
async function load(t,entry){
 const id=++nextRequest;
 const decoded=await new Promise((resolve,reject)=>{
  const cancel=()=>{tileWorker.postMessage({id,cancel:true});finish(Error('Tile cancelled'));};
  const finish=(error,data)=>{clearTimeout(timer);entry.abort.signal.removeEventListener('abort',cancel);pendingTiles.delete(id);error?reject(error):resolve(data);};
  const timer=setTimeout(()=>{tileWorker.postMessage({id,cancel:true});finish(new DOMException('Tile request timed out','TimeoutError'));},1000);
  pendingTiles.set(id,{resolve:data=>finish(null,data),reject:finish});
  entry.abort.signal.addEventListener('abort',cancel,{once:true});
  tileWorker.postMessage({id,t,metadata,retry:entry.attempts>0});
 });
 if(entry.abort.signal.aborted)return;
 const {size,values,overzoomed}=decoded;
 const texture=device.createTexture({size:[size,size],format:'rg32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC});device.queue.writeTexture({texture},values,{bytesPerRow:size*8},[size,size]);
 Object.assign(entry,{texture,size,overzoomed,state:'ready',bytes:values.byteLength});invalidateTerrain();
}
function pump(){while(active<8&&queue.length){
 const t=queue.shift(),entry=cache.get(t.key);if(!entry||entry.state!=='queued')continue;
 entry.state='loading';active++;
 load(t,entry).catch(e=>{if(!entry.abort.signal.aborted){
  entry.state='failed';entry.attempts=(entry.attempts||0)+1;console.warn(t.key,e);
  const cancelRetry=()=>clearTimeout(timer);
  const timer=setTimeout(()=>{
   entry.abort.signal.removeEventListener('abort',cancelRetry);
   if(cache.get(t.key)!==entry||entry.abort.signal.aborted)return;
   entry.state='queued';queue.push(t);report();pump();
  },e.name==='TimeoutError'?0:Math.min(30000,1000*2**Math.min(entry.attempts-1,5)));
  entry.abort.signal.addEventListener('abort',cancelRetry,{once:true});
 }}).finally(()=>{active--;report();requestRender();pump();});
}}

function updateView(){viewDirty=true;requestRender();}
function updateViewNow(){if(!device||!metadata)return;invalidateTerrain();dpr=window.devicePixelRatio||1;const rect=canvas.getBoundingClientRect();width=rect.width;height=rect.height;constrain();const pw=Math.max(1,Math.round(width*dpr)),ph=Math.max(1,Math.round(height*dpr));if(Math.max(pw,ph)>device.limits.maxTextureDimension2D){$('message').textContent='Viewport exceeds this GPU’s texture-size limit. Reduce window size.';return;}if(canvas.width!==pw)canvas.width=pw;if(canvas.height!==ph)canvas.height=ph;const lw=Math.max(1,Math.round(legend.clientWidth*dpr)),lh=Math.max(1,Math.round(legend.clientHeight*dpr));if(legend.width!==lw)legend.width=lw;if(legend.height!==lh)legend.height=lh;
 const maxzoom=Math.min(metadata.land.maxzoom??18,metadata.sea.maxzoom??18),tileSize=Math.min(metadata.land.tileSize||512,metadata.sea.tileSize||512);
 globeCamera=isSphere()?sphereCamera(view,width,height,dpr,sphereZoom):null;
 const z=sourceZoom(view.zoom,dpr,tileSize,maxzoom);tiles=globeCamera?sphereTiles(globeCamera,maxzoom,tileSize):visibleTiles(view,width,height,z);if(globeCamera&&!tiles.some(t=>t.z===0))tiles.unshift({z:0,x:0,y:0,key:'0/0/0',fallback:true});const requested=[...tiles];if(!requested.some(t=>t.z===0))requested.unshift({z:0,x:0,y:0,key:'0/0/0'});const needed=new Set(requested.map(t=>t.key));queue=[];
 for(const [key,entry] of cache){if(!needed.has(key)&&entry.state!=='ready'){entry.abort.abort();cache.delete(key);}}
 for(const t of requested){let entry=cache.get(t.key);if(!entry){entry={state:'queued',abort:new AbortController()};cache.set(t.key,entry);queue.push(t);}else if(entry.state==='queued'&&!queue.some(q=>q.key===t.key))queue.push(t);entry.used=performance.now();}
 // Bound CPU and GPU storage without discarding visible tiles.
 let bytes=[...cache.values()].reduce((sum,e)=>sum+(e.bytes||0),0);for(const [key,entry] of [...cache].sort((a,b)=>a[1].used-b[1].used)){if(bytes<256*1024*1024)break;if(!needed.has(key)){bytes-=(entry.bytes||0);entry.texture?.destroy();cache.delete(key);}}
 $('pixels').textContent=`${pw} × ${ph} / ${dpr}×`;$('level').textContent=globeCamera?`z${Math.min(...tiles.filter(t=>!t.fallback).map(t=>t.z))}–${Math.max(...tiles.filter(t=>!t.fallback).map(t=>t.z))} / sphere`:`z${z} / view ${view.zoom.toFixed(2)}`;const lon=wrap(view.x,1)*360-180,lat=Math.atan(Math.sinh(Math.PI*(1-2*view.y)))*180/Math.PI;$('position').textContent=`${Math.abs(lat).toFixed(3)}°${lat>=0?'N':'S'} ${Math.abs(lon).toFixed(3)}°${lon>=0?'E':'W'}`;$('scale').textContent=`${(globeCamera?6378137/globeCamera.radius:40075016.686*Math.cos(lat*Math.PI/180)/(256*2**view.zoom*dpr)).toFixed(2)} m / device px${globeCamera?' at center':''}`;history.replaceState(null,'',`#${view.zoom.toFixed(4)}/${view.x.toFixed(7)}/${view.y.toFixed(7)}`);report();pump();}
function flatRenderTiles(){return tiles.flatMap(t=>{
 if(cache.get(t.key)?.state==='ready')return [t];
 for(let z=t.z-1;z>=0;z--){const factor=2**(t.z-z),x=Math.floor(t.x/factor),y=Math.floor(t.y/factor),sourceKey=`${z}/${wrap(x,2**z)}/${y}`;
  if(cache.get(sourceKey)?.state==='ready')return [{...t,sourceKey,uv:[wrap(t.x,factor)/factor,wrap(t.y,factor)/factor,1/factor]}];
 }return [];
});}
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
 if(!renderer)return;const easing=advanceExposure(time);if(reducedMotion.matches)edgeTransition.snap($('edges').checked?1:0);highlightLabel();
 const revision=exposureConfig;
 const started=renderer.render({tiles:globeCamera?tiles:flatRenderTiles(),cache,dpr,canvas,legend,min,max,palette:Number($('palette').value),reversed:$('palette-flip').getAttribute('aria-pressed')==='true',hdr:toneMapping==='extended'?2:1,p3:colorSpace==='display-p3'?1:0,selectedElevation:activeElevation(),highlightWidth:activeWidth(),emphasis:hovering||$('highlight').checked,edges:edgeTransition.valueAt(time),noOcean:!$('water').checked,sphere:globeCamera,reduce:exposureDirty&&(! locks.min||! locks.max),onExposure(lo,hi){
  if(revision===exposureConfig&&lo<=hi){
   const now=performance.now();advanceExposure(now);
   const minLocked=locks.min,maxLocked=locks.max;
   if(!minLocked&&!maxLocked){exposureTargets.min=lo;exposureTargets.max=Math.max(lo+1/256,hi);}
   else if(!minLocked)exposureTargets.min=Math.min(lo,max-1/256);
   else if(!maxLocked)exposureTargets.max=Math.max(min+1/256,hi);
   retargetExposure(now);controls();requestRender();
  }else if(exposureDirty)requestRender();
 }});
 if(started)exposureDirty=false;if(easing||edgeTransition.active(time))requestRender();
}
async function init(){if(!navigator.gpu)throw Error('WebGPU is unavailable. Open in a WebGPU browser on localhost or HTTPS.');const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('No WebGPU adapter available.');device=await adapter.requestDevice({requiredLimits:{maxTextureDimension2D:adapter.limits.maxTextureDimension2D,maxTextureArrayLayers:adapter.limits.maxTextureArrayLayers}});device.lost.then(info=>{$('message').textContent='GPU device lost: '+info.message+'. Reload to reconnect.';});device.addEventListener('uncapturederror',e=>{$('message').textContent=e.error.message;console.error(e.error);});context=canvas.getContext('webgpu');legendContext=legend.getContext('webgpu');let configured=false;for(const candidate of ['rgba16float',navigator.gpu.getPreferredCanvasFormat()]){for(const mode of ['extended','standard']){try{for(const ctx of [context,legendContext])ctx.configure({device,format:candidate,colorSpace,alphaMode:'opaque',toneMapping:{mode}});format=candidate;toneMapping=mode;configured=true;break;}catch{}}if(configured)break;}if(!configured){colorSpace='srgb';format=navigator.gpu.getPreferredCanvasFormat();toneMapping='standard';for(const ctx of [context,legendContext])ctx.configure({device,format,alphaMode:'opaque'});}
 $('hdr').textContent=`${toneMapping==='extended'?'HDR':'SDR'} / ${colorSpace==='display-p3'?'P3':'sRGB'}`;renderer=await createRenderer(device,format,context,legendContext);
 const meta=await Promise.allSettled(['https://tiles.mapterhorn.com/tilejson.json','https://tiles.openwaters.io/seascape/raster.json'].map(async url=>{const r=await fetch(url);if(!r.ok)throw Error(r.status);return r.json();}));metadata={land:meta[0].status==='fulfilled'?meta[0].value:fallback.land,sea:meta[1].status==='fulfilled'?meta[1].value:fallback.sea};if(metadata.sea.schema!==1)throw Error('Unsupported Seascape schema. Expected version 1.');controls();highlightLabel();new ResizeObserver(updateView).observe(canvas);window.addEventListener('resize',updateView);let currentDpr=window.devicePixelRatio;setInterval(()=>{if(currentDpr!==window.devicePixelRatio){currentDpr=window.devicePixelRatio;updateView();}},500);updateView();}
function setLocked(id,locked){locks[id]=locked;const button=$(id+'-lock'),label=`${locked?'Unlock':'Lock'} ${id==='min'?'minimum':'maximum'} elevation`;button.setAttribute('aria-pressed',locked);button.setAttribute('aria-label',label);button.title=label;$(id).closest('.slider-control').classList.toggle('is-locked',locked);if(locked){exposureTargets[id]=id==='min'?min:max;exposureTweens[id].snap(exposureTargets[id]);}}
for(const id of ['min','max']){
 $(id).addEventListener('input',()=>{
  if(id==='min'){min=Math.min(Number($('min').value),max-1);exposureTargets.max=Math.max(exposureTargets.max,min+1/256);}else{max=Math.max(Number($('max').value),min+1);exposureTargets.min=Math.min(exposureTargets.min,max-1/256);}
  setLocked(id,true);const other=id==='min'?'max':'min';if(exposureTweens[other].target!==exposureTargets[other])exposureTweens[other].start(other==='min'?min:max,exposureTargets[other],performance.now());controls();requestRender();
 });
 $(id+'-lock').addEventListener('click',()=>{setLocked(id,!locks[id]);exposureDirty=true;controls();requestRender();});
}
$('water').addEventListener('change',()=>{exposureConfig++;invalidateTerrain();requestRender();});
$('edges').addEventListener('change',()=>{edgeTransition.retarget($('edges').checked?1:0,performance.now());requestRender();});
const meters=value=>value.toLocaleString(undefined,{maximumFractionDigits:3})+' m';
function activeElevation(){return hovering&&previewElevation!==null?previewElevation:pinnedElevation??elevationAt(.5,min,max);}
function activeWidth(){return lockedHighlightWidth??defaultHighlightWidth(min,max,highlightFraction);}
function initializeHighlight(){if(pinnedElevation===null)pinnedElevation=elevationAt(.5,min,max);}
function highlightLabel(){
 if(hovering)previewElevation=elevationAt(hoverPosition,min,max);
 const elevation=activeElevation(),halfWidth=activeWidth(),active=hovering||$('highlight').checked;
 legend.setAttribute('aria-valuemin',Math.min(min,elevation));legend.setAttribute('aria-valuemax',Math.max(max,elevation));legend.setAttribute('aria-valuenow',elevation);legend.setAttribute('aria-valuetext',meters(elevation));
 $('highlight-value').textContent=`${meters(elevation)} · ${hovering?'preview':$('highlight').checked?'pinned':pinnedElevation===null?'not selected':'off'}`;
 $('highlight-value').dataset.elevation=elevation;
 $('highlight-band').textContent=active?`${meters(elevation-halfWidth)} to ${meters(elevation+halfWidth)}${elevation<min||elevation>max?' · center outside scale':''}`:'Hover to preview · click to pin an elevation';
 const hoverLabel=$('legend-hover');hoverLabel.hidden=!hovering;hoverLabel.style.setProperty('--position',hoverPosition*100);$('legend-hover-value').textContent=meters(elevation);
 $('highlight-controls').disabled=!active;const elevationControl=$('highlight-elevation');elevationControl.value=elevation;
 const widthControl=$('highlight-width');widthControl.min=Math.min((max-min)*.000001,halfWidth);widthControl.max=Math.max(max-min,halfWidth);widthControl.value=halfWidth;syncNumbers();
}
function previewHighlight(event){const rect=legend.getBoundingClientRect(),position=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));hoverPosition=position;previewElevation=elevationAt(position,min,max);hovering=true;highlightLabel();requestRender();}
legend.addEventListener('pointerenter',previewHighlight);legend.addEventListener('pointermove',previewHighlight);
legend.addEventListener('pointerdown',event=>{legend.setPointerCapture(event.pointerId);previewHighlight(event);pinnedElevation=previewElevation;$('highlight').checked=true;});
legend.addEventListener('pointerup',event=>{previewHighlight(event);pinnedElevation=previewElevation;if(event.pointerType!=='mouse'){hovering=false;highlightLabel();requestRender();}});
for(const event of ['pointerleave','pointercancel'])legend.addEventListener(event,()=>{hovering=false;highlightLabel();requestRender();});
$('highlight').addEventListener('change',()=>{if($('highlight').checked)initializeHighlight();hovering=false;highlightLabel();requestRender();});
$('highlight-elevation').addEventListener('input',()=>{pinnedElevation=Number($('highlight-elevation').value);hovering=false;highlightLabel();requestRender();});
$('highlight-width').addEventListener('input',()=>{const value=Number($('highlight-width').value);if(lockedHighlightWidth!==null)lockedHighlightWidth=value;else highlightFraction=value/(max-min);highlightLabel();requestRender();});
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
 if(event.key==='Escape'){$('highlight').checked=false;hovering=false;}
 else if(['ArrowLeft','ArrowRight','Home','End','Enter',' '].includes(event.key)){
  initializeHighlight();const step=(max-min)*.01;
  if(event.key==='ArrowLeft')pinnedElevation-=step;if(event.key==='ArrowRight')pinnedElevation+=step;if(event.key==='Home')pinnedElevation=min;if(event.key==='End')pinnedElevation=max;
  $('highlight').checked=true;hovering=false;
 }else return;event.preventDefault();highlightLabel();requestRender();
});
$('palette').addEventListener('change',requestRender);
$('palette-flip').addEventListener('click',()=>{const button=$('palette-flip');button.setAttribute('aria-pressed',button.getAttribute('aria-pressed')!=='true');requestRender();});
const sliderIds=['min','max','highlight-elevation','highlight-width'];
function syncNumbers(){for(const id of sliderIds){const range=$(id),number=$(id+'-number');if(!number)continue;number.min=range.min;number.max=range.max;number.disabled=range.disabled||Boolean(range.closest('fieldset')?.disabled);if(document.activeElement!==number)number.value=String(Number(Number(range.value).toPrecision(6)));}}
for(const id of sliderIds){const range=$(id),number=$(id+'-number');number.addEventListener('input',()=>{if(number.value===''||!Number.isFinite(number.valueAsNumber))return;range.value=Math.min(Number(range.max),Math.max(Number(range.min),number.valueAsNumber));range.dispatchEvent(new Event('input'));});number.addEventListener('change',()=>{number.value=range.value;});}
for(const button of document.querySelectorAll('[data-step-slider]'))button.addEventListener('click',()=>{const range=$(button.dataset.stepSlider),step=range.step==='any'?1:Number(range.step);range.value=Number(range.value)+Number(button.dataset.stepDir)*step;range.dispatchEvent(new Event('input'));});
const panel=$('map-panel');
function fullscreenState(){const active=document.fullscreenElement===panel||panel.classList.contains('is-expanded');$('fullscreen').setAttribute('aria-pressed',active);$('fullscreen').setAttribute('aria-label',active?'Exit fullscreen':'Enter fullscreen');$('fullscreen').title=active?'Exit fullscreen':'Enter fullscreen';document.body.classList.toggle('canvas-fullscreen',active);updateView();}
$('fullscreen').addEventListener('click',async()=>{
 if(document.fullscreenElement===panel||panel.classList.contains('is-expanded'))return;
 try{if(!panel.requestFullscreen)throw Error();await panel.requestFullscreen();}catch{panel.classList.add('is-expanded');}
 fullscreenState();canvas.focus({preventScroll:true});
});
document.addEventListener('fullscreenchange',fullscreenState);
window.addEventListener('keydown',async event=>{if(event.key!=='Escape')return;stopMomentum();stopNavigation();if(document.fullscreenElement===panel)await document.exitFullscreen().catch(()=>{});if(panel.classList.contains('is-expanded')){panel.classList.remove('is-expanded');fullscreenState();}});
function isSphere(){return $('projection').checked;}
$('projection').addEventListener('change',()=>{exposureConfig++;stopMomentum();$('projection-label').textContent=isSphere()?'GLOBAL ELEVATION / SPHERE':'GLOBAL ELEVATION / WEB MERCATOR';updateView();});
function panBy(dx,dy){lastViewMotion=performance.now();
 if(isSphere()){const radius=Math.min(width,height)*.46*2**sphereZoom;view.x-=dx/(2*Math.PI*radius);let lat=Math.atan(Math.sinh(Math.PI*(1-2*view.y)))+dy/radius;lat=Math.max(-1.48442223,Math.min(1.48442223,lat));view.y=(1-Math.log(Math.tan(Math.PI/4+lat/2))/Math.PI)/2;}
 else{const scale=256*2**view.zoom;view.x-=dx/scale;view.y-=dy/scale;}
 const requestedY=view.y;constrain();return requestedY!==view.y;
}
function zoomCeiling(){return maximumMapZoom(Object.values(metadata??fallback));}
function constrain(){view.x=wrap(view.x,1);view.zoom=Math.max(minimumMapZoom(height),Math.min(zoomCeiling(),view.zoom));sphereZoom=Math.max(-1,Math.min(maximumSphereZoom(width,height,zoomCeiling()),sphereZoom));if(isSphere())view.y=Math.max(0,Math.min(1,view.y));else{view.y=boundedMapY(view.y,view.zoom,height);}}
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
 cursor={x:e.clientX,y:e.clientY,inside:true};
 if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const next=snapshot(),s=256*2**view.zoom,now=performance.now(),dt=Math.max(1,now-lastMove),dx=next.x-gesture.x,dy=next.y-gesture.y;
 panBy(dx,dy);
 if(pointers.size===1){const mix=1-Math.exp(-dt/25);velocityX+=(Math.max(-2.5,Math.min(2.5,dx/dt))-velocityX)*mix;velocityY+=(Math.max(-2.5,Math.min(2.5,dy/dt))-velocityY)*mix;}else velocityX=velocityY=0;
 if(next.distance&&gesture.distance){const r=canvas.getBoundingClientRect();zoomAt(Math.log2(next.distance/gesture.distance),next.x-r.left-width/2,next.y-r.top-height/2);}else{constrain();updateView();}gesture=next;lastMove=now;
});
for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,e=>{if(!pointers.has(e.pointerId))return;const single=pointers.size===1;pointers.delete(e.pointerId);gesture=pointers.size?snapshot():null;if(event==='pointerup'&&single)startMomentum();else stopMomentum();lastMove=pointers.size?performance.now():lastMove;});
window.addEventListener('blur',stopMomentum);document.addEventListener('visibilitychange',()=>{if(document.hidden)stopMomentum();});
let cursor={x:0,y:0,inside:false},navigationFrame=0,navigationTime=0,navX=0,navY=0,navZoom=0;
const heldKeys=new Map(),tapUntil=new Map();
canvas.addEventListener('pointerenter',event=>{cursor={x:event.clientX,y:event.clientY,inside:true};});canvas.addEventListener('pointerleave',()=>{cursor.inside=false;});
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
