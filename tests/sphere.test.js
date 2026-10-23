import {test} from 'node:test';import assert from 'node:assert/strict';import {sphereCamera,sphereTiles,maximumSphereZoom} from '../sphere.js';
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
test('globe camera has an orthonormal basis and uses full DPR',()=>{const c=sphereCamera({x:.72,y:.38},1000,800,3);assert.equal(c.width,3000);assert.equal(c.radius,1104);for(const a of [c.right,c.up,c.front])assert.ok(Math.abs(dot(a,a)-1)<1e-12);assert.ok(Math.abs(dot(c.right,c.up))<1e-12);assert.ok(Math.abs(dot(c.up,c.front))<1e-12);});
test('globe tiles meet projected device-pixel resolution, respecting the source ceiling',()=>{for(const dpr of [1,3]){const c=sphereCamera({x:.5,y:.5},1000,800,dpr);const tiles=sphereTiles(c,18);assert.ok(tiles.length>0);for(const t of tiles){const n=2**t.z,north=Math.atan(Math.sinh(Math.PI*(1-2*t.y/n))),south=Math.atan(Math.sinh(Math.PI*(1-2*(t.y+1)/n))),closest=south<=0&&north>=0?0:Math.min(Math.abs(south),Math.abs(north));assert.ok(2*Math.PI*c.radius*Math.cos(closest)/(512*n)<=1+1e-12);}}});
test('globe quadtree covers ray-projected visible locations including the dateline',()=>{const view={x:.995,y:.4},c=sphereCamera(view,1000,800,2,1),tiles=sphereTiles(c);for(let y=0;y<c.height;y+=37)for(let x=0;x<c.width;x+=37){const px=(x-c.width/2)/c.radius,py=(y-c.height/2)/c.radius,r2=px*px+py*py;if(r2>=1)continue;const p=c.right.map((v,i)=>v*px-c.up[i]*py+c.front[i]*Math.sqrt(1-r2)),lat=Math.asin(p[1]);if(Math.abs(lat)>1.48442223)continue;const u=((Math.atan2(p[0],p[2])/(2*Math.PI)+.5)%1+1)%1,v=(1-Math.log(Math.tan(Math.PI/4+lat/2))/Math.PI)/2;assert.ok(tiles.some(t=>Math.floor(u*2**t.z)===t.x&&Math.floor(v*2**t.z)===t.y),`missing ${u},${v}`);}});

test('sphere zoom keeps the same surface point under the cursor',async()=>{const {spherePointAt,zoomSphereAt}=await import('../sphere.js');for(const view of [{x:.5,y:.42},{x:.995,y:.4},{x:.2,y:.65}])for(const [x,y] of [[0,0],[100,60],[-200,40],[0,-200]]){const point=spherePointAt(view,1000,800,0,x,y),next=zoomSphereAt(view,1000,800,0,1,x,y),after=spherePointAt(next,1000,800,1,x,y);for(let i=0;i<3;i++)assert.ok(Math.abs(point[i]-after[i])<1e-10,`${JSON.stringify(view)} at ${x},${y}`);}});

test('sphere zoom ceiling uses globally finest equatorial resolution in CSS pixels',()=>{
 for(const [width,height] of [[1000,800],[390,844],[1920,1080]]){
  const zoom=maximumSphereZoom(width,height,19);
  for(const dpr of [1,2,3])for(const y of [.2,.5,.8]){
   const camera=sphereCamera({x:.5,y},width,height,dpr,zoom);
   assert.ok(Math.abs(2*Math.PI*camera.radius/dpr/(512*2**18)-1)<1e-12);
  }
 }
});
