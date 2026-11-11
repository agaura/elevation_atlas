import test from 'node:test';
import assert from 'node:assert/strict';
import {imageryTiles,IMAGERY_SOURCES} from '../imagery.js';
import {sphereCamera} from '../sphere.js';
test('Earth imagery chooses device-pixel resolution and wraps the dateline',()=>{
 const options={view:{x:.999,y:.5,zoom:4},width:800,height:600,dpr:1,camera:null};
 const one=imageryTiles('earth',options),two=imageryTiles('earth',{...options,dpr:2});
 assert.ok(Math.max(...two.map(t=>t.z))>Math.max(...one.map(t=>t.z)));
 assert.ok(two.every(t=>t.x>=0&&t.x<2**t.z&&t.y>=0&&t.y<2**t.z));
 assert.ok(one.some(t=>t.x===0));
});
test('planetary imagery uses the providers geographic 2:1 tile grids',()=>{
 for(const body of ['mars','moon'])for(const x of [.001,.5,.999]){
  const view={x,y:.5,zoom:3},camera=sphereCamera(view,800,600,2,0),tiles=imageryTiles(body,{view,width:800,height:600,dpr:2,camera});
  assert.ok(tiles.length>0&&tiles.length<300);assert.ok(tiles.every(t=>t.z<=IMAGERY_SOURCES[body].maxzoom&&t.x>=0&&t.x<2**(t.z+1)&&t.y>=0&&t.y<2**t.z));
 }
});
