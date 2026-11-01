// A linear elevation sweep followed by a hold outside the visible range.
export function highlightPulse(elapsedMs,durationSeconds,delaySeconds,min,max,halfWidth){
 const duration=Math.max(1,durationSeconds*1000),delay=Math.max(0,delaySeconds*1000);
 const period=duration+delay,phase=Math.max(0,elapsedMs)%period;
 const position=Math.min(1,phase/duration);
 return {elevation:(min-halfWidth)+(max-min+2*halfWidth)*position,
  sweeping:phase<duration,waitMs:phase<duration?0:period-phase};
}

// Rephase a sweep at the elevation currently on screen after a hover override.
export function pulseElapsedAtElevation(elevation,durationSeconds,min,max,halfWidth){
 const span=max-min+2*halfWidth;
 const position=span>0?(elevation-(min-halfWidth))/span:0;
 return Math.max(0,Math.min(1-Number.EPSILON,position))*Math.max(1,durationSeconds*1000);
}
