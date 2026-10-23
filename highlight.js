export const elevationAt=(position,min,max)=>min+position*(max-min);
export const defaultHighlightWidth=(min,max,fraction=1/8)=>(max-min)*fraction;
// Half-width H: strength is zero at E±H, one at E, and quadratic between.
export function highlightStrength(elevation,center,halfWidth){return Math.max(0,1-Math.abs(elevation-center)/halfWidth)**2;}
