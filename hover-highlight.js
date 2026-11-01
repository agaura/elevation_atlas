// Visual Shift-hover motion only. Raw readings and saved elevations stay exact.
export class HoverHighlightFilter {
 constructor(){this.reset(0,0);}
 reset(value,time){
  this.velocity=0;this.value=value;this.raw=value;this.filteredTarget=value;
  this.samples=[{time,value}];this.lastTime=time;this.lastChange=time;
  this.settleStart=null;this.active=false;this.coherence=1;
 }
 advance(raw,time){
  const dt=Math.max(0,time-this.lastTime);this.lastTime=time;
  if(Math.abs(raw-this.raw)>1e-6){
   this.raw=raw;this.samples.push({time,value:raw});this.lastChange=time;this.settleStart=null;
  }
  while(this.samples.length>1&&this.samples[1].time<=time-300)this.samples.shift();
  if(time-this.lastChange>=100){
   if(this.settleStart===null){
    this.settleStart=time;this.settleValue=this.value;
    const delta=raw-this.value;
    this.settleVelocity=Math.sign(delta)*Math.max(0,Math.min(Math.sign(delta)*this.velocity,3*Math.abs(delta)/.3));
   }
   // Monotone cubic reaches the exact sample with zero final velocity.
   const u=Math.min(1,(time-this.settleStart)/300),u2=u*u,u3=u2*u,delta=raw-this.settleValue;
   this.value=this.settleValue+(-2*u3+3*u2)*delta+(u3-2*u2+u)*.3*this.settleVelocity;
   this.velocity=((-6*u2+6*u)*delta+(3*u2-4*u+1)*.3*this.settleVelocity)/.3;
   this.filteredTarget=raw;this.active=u<1&&this.value!==raw;
   if(u===1){this.value=raw;this.velocity=0;}
   return this.value;
  }
  // Time-weighted 50 ms median rejects brief ridge excursions independently
  // of how many display frames occur within that interval.
  const start=Math.max(this.samples[0].time,time-50),weighted=[];
  for(let i=0;i<this.samples.length;i++){
   const sample=this.samples[i],end=this.samples[i+1]?.time??time;
   const duration=Math.max(0,Math.min(time,end)-Math.max(start,sample.time));
   if(duration)weighted.push({value:sample.value,duration});
  }
  weighted.sort((a,b)=>a.value-b.value);
  const total=weighted.reduce((sum,s)=>sum+s.duration,0);let cumulative=0,median=raw;
  for(const sample of weighted){cumulative+=sample.duration;if(cumulative>=total*.5){median=sample.value;break;}}
  let travel=0;for(let i=1;i<this.samples.length;i++)travel+=Math.abs(this.samples[i].value-this.samples[i-1].value);
  this.coherence=travel?Math.abs(raw-this.samples[0].value)/travel:1;
  this.filteredTarget=median;
  // Critically damped motion smooths velocity too. Repeated reversals use
  // stronger damping; consistent slopes retain the faster response.
  const omega=8+14*this.coherence,seconds=dt/1000;
  const offset=this.value-median,c=this.velocity+omega*offset,decay=Math.exp(-omega*seconds);
  const candidate=median+(offset+c*seconds)*decay;
  this.velocity=(this.velocity-omega*c*seconds)*decay;
  let low=this.value,high=this.value;
  for(const sample of this.samples){low=Math.min(low,sample.value);high=Math.max(high,sample.value);}
  this.value=Math.max(low,Math.min(high,candidate));
  if(this.value!==candidate)this.velocity=0;
  this.active=Math.abs(raw-this.value)>1e-6||Math.abs(this.velocity)>1e-6;
  return this.value;
 }
}
