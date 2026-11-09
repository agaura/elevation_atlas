import {SineTransition} from './exposure.js';
// Fade an outgoing region back to the full map, then fade into the next region.
export class RegionTransition{
 constructor(){this.mask=null;this.pending=null;this.fade=new SineTransition(0,200);}
 update(target,time,reduced=false){
  this.pending=target;
  if(!this.mask&&target){this.mask=target;this.fade.snap(0);}
  const same=this.mask&&target&&this.mask.revision===target.revision;
  this.fade.retarget(same?1:0,time);
  if(reduced)this.fade.snap(same?1:0);
  if(this.mask&&!same&&this.fade.valueAt(time)<=.00001){
   this.mask=target;this.fade.snap(0);
   if(target){this.fade.retarget(1,time);if(reduced)this.fade.snap(1);}
  }
  return this.mask?{...this.mask,strength:this.fade.valueAt(time)}:null;
 }
 active(time){return this.fade.active(time);}
 reset(){this.mask=null;this.pending=null;this.fade.snap(0);}
}
