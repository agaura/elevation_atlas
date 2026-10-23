export const sineEase=t=>(1-Math.cos(Math.PI*Math.max(0,Math.min(1,t))))/2;
// Finite-duration, frame-rate-independent slow/fast/slow transition.
export class SineTransition{
 constructor(value,duration=500){this.from=value;this.target=value;this.startTime=0;this.duration=duration;}
 valueAt(time){return this.from+(this.target-this.from)*sineEase((time-this.startTime)/this.duration);}
 start(from,target,time){this.from=from;this.target=target;this.startTime=time;}
 retarget(target,time){if(target===this.target)return;this.start(this.valueAt(time),target,time);}
 snap(value){this.from=this.target=value;}
 active(time){return this.from!==this.target&&time<this.startTime+this.duration;}
}

// Retargetable exposure that keeps its sine phase instead of restarting it.
// During movement the phase advances to 1/2, then retains that response rate.
export class ExposureTransition{
 constructor(value,duration=500){this.current=this.target=value;this.phase=1;this.duration=duration;this.lastTime=null;this.moving=false;}
 advance(time,moving=false){
  let dt=this.lastTime===null?0:Math.max(0,time-this.lastTime);this.lastTime=time;
  if(moving&&!this.moving){this.phase=0;dt=0;}this.moving=moving;
  if(this.phase>=1){this.current=this.target;return this.current;}
  const next=Math.min(moving ? .5 : 1,this.phase+dt/this.duration),before=sineEase(this.phase),after=sineEase(next);
  let gain=before>=1?1:Math.max(0,Math.min(1,(after-before)/(1-before)));
  if(moving){const remaining=Math.max(0,dt-(next-this.phase)*this.duration);gain=1-(1-gain)*Math.exp(-Math.PI*remaining/this.duration);}
  this.current+=(this.target-this.current)*gain;this.phase=next;
  if(!moving&&this.phase>=1)this.current=this.target;
  return this.current;
 }
 retarget(target,time,moving=false){this.advance(time,moving);if(target===this.target)return;if(this.phase>=1)this.phase=0;this.target=target;}
 start(from,target,time){this.current=from;this.target=target;this.phase=0;this.lastTime=time;}
 snap(value){this.current=this.target=value;this.phase=1;}
 active(){return this.current!==this.target&&this.phase<1;}
}
