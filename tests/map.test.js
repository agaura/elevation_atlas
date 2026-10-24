import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeVectorTile,geometry} from '../vector-tile.js';
import {mapProject,roadWidth,placeStyle,RoadContext,pathIntersects,spherePathIntersects} from '../map-overlay.js';
import {sphereCamera} from '../sphere.js';
import {mapFixture,zigzag} from './vector-fixture.js';
test('MVT decoder retains roads, boundaries, labels and properties while skipping other layers',()=>{
 const layers=decodeVectorTile(mapFixture());assert.deepEqual(layers.map(l=>l.name),['transportation','boundary','place']);
 assert.deepEqual(layers[0].features[0].paths,[[512,2048,3584,2048]]);
 assert.equal(layers[1].features[0].properties.admin_level,2);assert.equal(layers[2].features[0].properties.name,'Atlas City');
 assert.deepEqual(layers[2].features[0].paths,[[2800,2048]]);assert.equal(layers[0].extent,4096);
});
test('MVT command decoder handles signed deltas, multiple paths and polygon closure',()=>{
 assert.deepEqual(geometry([9,zigzag(-2),zigzag(3),18,zigzag(5),zigzag(0),zigzag(0),zigzag(-5),15]),[[-2,3,3,3,3,-2,-2,3]]);
 assert.deepEqual(geometry([17,2,2,2,2]),[[1,1],[2,2]]);assert.throws(()=>geometry([10,2,2]));assert.throws(()=>decodeVectorTile(new Uint8Array([26,100,1])));
});
test('map vector projection aligns with terrain in flat and sphere views, including wrapped copies',()=>{
 const view={x:.5,y:.5,zoom:3},tile={x:0,y:0,z:0};assert.deepEqual(mapProject(view,800,600,null,tile,4096,2048,2048),[400,300]);
 const camera=sphereCamera(view,800,600,1,0);const p=mapProject(view,800,600,camera,tile,4096,2048,2048);assert.deepEqual(p,[400,300]);assert.equal(mapProject(view,800,600,camera,tile,4096,0,2048),null);
 const wrapped=mapProject({x:0,y:.5,zoom:3},800,600,null,{x:-1,y:0,z:0},4096,4096,2048);assert.deepEqual(wrapped,[400,300]);
});
test('road detail increases with zoom while line widths stay in CSS pixels',()=>{assert.equal(roadWidth('motorway',2),0);assert.ok(roadWidth('motorway',5)>0);assert.equal(roadWidth('path',12),0);assert.ok(roadWidth('path',15)>0);assert.equal(roadWidth('primary',12),roadWidth('primary',19));});

test('administrative and settlement labels wait for their map context zoom',()=>{
 assert.equal(placeStyle({class:'state'},4),null);assert.equal(placeStyle({class:'state'},5).boundary,true);
 assert.equal(placeStyle({class:'city',rank:1},5),null);assert.equal(placeStyle({class:'city',rank:1},6).roads,true);
 assert.equal(placeStyle({class:'town'},8),null);assert.equal(placeStyle({class:'town'},9).roads,true);
});
test('settlement context requires a drawn road nearby, including long crossing segments',()=>{
 const roads=new RoadContext(800,600);assert.equal(roads.near([400,300]),false);
 roads.add([-10000,300],[10000,300]);assert.equal(roads.near([400,300]),true);assert.equal(roads.near([400,330]),false);
 roads.add([100,100],[110,110]);assert.equal(roads.near([115,110]),true);assert.equal(roads.near([700,500]),false);
});

test('local map detail waits for twice the magnification while administrative context stays unchanged',()=>{
 assert.equal(roadWidth('motorway',3),0);assert.ok(roadWidth('motorway',4)>0);
 assert.equal(roadWidth('primary',5),0);assert.ok(roadWidth('primary',6)>0);
 assert.equal(placeStyle({class:'village'},10),null);assert.ok(placeStyle({class:'village'},11));
 assert.ok(placeStyle({class:'country'},2));assert.ok(placeStyle({class:'state'},5));
});

test('administrative labels outrank and exceed settlement labels in size',()=>{
 const country=placeStyle({class:'country'},7),state=placeStyle({class:'state'},7),city=placeStyle({class:'city',rank:1},7),town=placeStyle({class:'town'},9);
 assert.ok(country.size>state.size&&state.size>city.size&&city.size>town.size);
 assert.ok(country.priority<state.priority&&state.priority<city.priority);
 assert.ok(state.family.includes('Rajdhani'));assert.ok(city.family.includes('Plex Mono'));assert.equal(state.upper,false);assert.equal(state.color,city.color);
});

test('all map label tiers share the same HDR blue source color',()=>{
 const colors=['continent','country','state','city','town','village','suburb'].map(kind=>placeStyle({class:kind,rank:1},kind==='continent'?2:kind==='country'||kind==='state'?7:15).color);
 assert.deepEqual([...new Set(colors)],['#8fc5ff']);
});

test('source-space path culling retains crossing paths even with both endpoints offscreen',()=>{
 const viewport=[0,0,100,100];assert.equal(pathIntersects([-50,50,150,50],viewport),true);assert.equal(pathIntersects([-50,-20,150,-10],viewport),false);assert.equal(pathIntersects([20,20],viewport),true);assert.equal(pathIntersects([120,20],viewport),false);
});

test('globe path culling preserves visible curves and rejects offscreen and back-facing paths',()=>{
 const tile={z:0,x:0,y:0},extent=4096,camera=sphereCamera({x:.5,y:.5},800,600,1,3);
 assert.equal(spherePathIntersects([2040,2040,2056,2056],tile,extent,camera),true);
 assert.equal(spherePathIntersects([2048,2048],tile,extent,camera),true);
 assert.equal(spherePathIntersects([0,2048,10,2048],tile,extent,camera),false);
 assert.equal(spherePathIntersects([2600,2000,2650,2100],tile,extent,camera),false);
 // Neither endpoint is in view; the intervening curve crosses the canvas.
 assert.equal(spherePathIntersects([1400,2048,2700,2048],tile,extent,camera),true);
 let seed=5297;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
 for(let i=0;i<500;i++){
  const view={x:random(),y:.1+.8*random()},cam=sphereCamera(view,800,600,1,random()*5),t={z:Math.floor(random()*7),x:0,y:0};t.x=Math.floor(random()*2**t.z);t.y=Math.floor(random()*2**t.z);
  const path=[random()*4096,random()*4096,random()*4096,random()*4096];
  if(spherePathIntersects(path,t,extent,cam,0))continue;
  for(let j=0;j<=32;j++){const u=j/32,p=mapProject(view,800,600,cam,t,extent,path[0]*(1-u)+path[2]*u,path[1]*(1-u)+path[3]*u);assert.ok(!p||p[0]<0||p[0]>800||p[1]<0||p[1]>600);}
 }
});

test('targeted road proximity matches the segment index without storing every road segment',()=>{
 const points=[[20,20],[300,200],[799,599],[50,80],[400,250]],normal=new RoadContext(800,600),targeted=new RoadContext(800,600,points);
 const segments=[[[-200,20],[1000,20]],[[280,210],[320,210]],[[900,700],[790,590]],[[0,400],[800,400]],[[51,105],[90,105]]];
 for(const [a,b] of segments){normal.add(a,b);targeted.add(a,b);}
 for(const point of points)assert.equal(targeted.near(point),normal.near(point));
 assert.equal(targeted.cells.size,points.length);assert.equal(targeted.hits.size,3);
});
