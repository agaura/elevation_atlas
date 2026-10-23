// SST point-cloud damping (0.966 per 60 Hz frame), integrated in elapsed time.
const TAU=-(1000/60)/Math.log(.966);
export function coastStep(vx,vy,dt){const decay=Math.exp(-dt/TAU);return {dx:vx*TAU*(1-decay),dy:vy*TAU*(1-decay),vx:vx*decay,vy:vy*decay};}
