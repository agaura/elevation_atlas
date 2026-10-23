export const wrap=(x,n)=>((x%n)+n)%n;
export function sourceZoom(zoom,dpr,tileSize=512,maxzoom=18){return Math.min(maxzoom,Math.max(0,Math.ceil(zoom+Math.log2(dpr*256/tileSize))));}
export function decode(r,g,b){return r*256+g+b/256-32768;}
// Only negative Seascape values are measurements. All nonnegative codes,
// including drying foreshore and fractional shoreline codes, use Mapterhorn.
export function merge(land,sea){if(Number.isFinite(sea)&&sea<0)return sea;return Number.isFinite(land)?land:NaN;}
export function visibleTiles(view,width,height,z){const scale=256*2**view.zoom,n=2**z;const left=view.x-width/2/scale,top=view.y-height/2/scale;const right=left+width/scale,bottom=top+height/scale;const out=[];for(let y=Math.max(0,Math.floor(top*n));y<Math.min(n,Math.ceil(bottom*n));y++)for(let x=Math.floor(left*n);x<Math.ceil(right*n);x++)out.push({x,y,z,key:`${z}/${wrap(x,n)}/${y}`,left:(x/n-left)*scale,top:(y/n-top)*scale,size:scale/n});return out;}
export const minimumMapZoom=height=>Math.max(0,Math.log2(Math.max(1,height)/256));
export function boundedMapY(y,zoom,height){const half=Math.min(.5,Math.max(0,height)/(2*256*2**zoom));return Math.max(half,Math.min(1-half,y));}

// World width in CSS pixels equals the finest provider's native world texels.
export function maximumMapZoom(sources){
 return Math.max(...sources.map(source=>(source.maxzoom??18)+Math.log2((source.tileSize||512)/256)));
}
