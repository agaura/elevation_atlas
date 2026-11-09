import {administrativeMaskLevel} from './region-geometry.js';
export class RegionMask{
 constructor(onChange,onStatus){this.onChange=onChange;this.onStatus=onStatus;this.serial=0;this.revision=0;this.signature='';this.active=false;this.mask=null;this.pinned=null;this.pinRequested=false;}
 pin(){
  if(!this.active)return;
  if(this.mask&&this.resolvedId===this.serial){this.pinned=this.mask;this.pinnedCaption=this.caption;this.onStatus('');this.worker?.postMessage({cancel:true});}
  else{this.pinRequested=true;this.send();}
  this.onChange();
 }
 unpin(){this.pinned=null;this.pinRequested=false;this.signature='';this.onChange();}
 update(point,zoom,enabled){
  if(this.pinRequested)return this.mask;
  const wasActive=this.active;this.active=enabled&&!!point;
  if(!this.active){if(wasActive)this.worker?.postMessage({cancel:true});clearTimeout(this.timer);this.timer=0;this.signature='';this.waiting=null;this.onStatus('');return this.pinned;}
  const longitude=point.x*360-180,latitude=Math.atan(Math.sinh(Math.PI*(1-2*point.y)))*180/Math.PI,level=administrativeMaskLevel(zoom);
  const signature=[longitude.toFixed(5),latitude.toFixed(5),level].join('/');
  if(signature!==this.signature){
   this.signature=signature;this.waiting={id:++this.serial,longitude,latitude,level};
   if(!this.timer)this.timer=setTimeout(()=>this.send(),this.mask?80:0);
  }
  return this.mask??this.pinned;
 }
 send(){
  this.timer=0;if(!this.active||!this.waiting)return;
  if(!this.worker){this.worker=new Worker(new URL('./region-mask.worker.js',import.meta.url),{type:'module'});this.worker.onmessage=({data})=>this.loaded(data);}
  this.onStatus(this.mask?this.caption:'Loading region boundary…');this.worker.postMessage(this.waiting);this.waiting=null;
 }
 loaded(data){
  if(!this.active||data.id!==this.serial){data.image?.close();return;}
  if(data.error){this.pinRequested=false;this.onStatus('Region boundary unavailable');if(this.mask!==this.pinned)this.mask?.image?.close();this.mask=null;this.worker.postMessage({ack:''});this.onChange();return;}
  if(data.empty){this.pinRequested=false;if(this.mask!==this.pinned)this.mask?.image?.close();this.mask=null;this.caption='';this.onStatus('');this.onChange();return;}
  if(data.same&&!this.mask){this.worker.postMessage({ack:''});this.signature='';this.onChange();return;}
  if(!data.same){if(this.mask!==this.pinned)this.mask?.image?.close();this.mask={...data,revision:++this.revision};this.worker.postMessage({ack:data.key});this.caption=`${data.name} · ${['Country','State / Province','County / District'][data.level]}`;}
  this.resolvedId=data.id;if(this.pinRequested&&this.mask){this.pinned=this.mask;this.pinnedCaption=this.caption;this.pinRequested=false;}
  this.onStatus(this.active?this.caption??'':'');this.onChange();
 }
}
