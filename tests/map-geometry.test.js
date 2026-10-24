import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildMapGeometry,ROAD_STYLES,roadStyle} from '../map-geometry.js';
import {decodeVectorTile} from '../vector-tile.js';
import {mapFixture} from './vector-fixture.js';
import {roadWidth,labelNearRoad,mapProject} from '../map-overlay.js';
import {sphereCamera} from '../sphere.js';
test('GPU stroke styles preserve all road visibility thresholds and widths',()=>{
 for(const kind of [...Object.keys(ROAD_STYLES),'unknown'])for(let zoom=0;zoom<=20;zoom++){const [width,minzoom]=roadStyle(kind);assert.equal(zoom>=minzoom?width:0,roadWidth(kind,zoom));}
});
test('GPU geometry splits source segments without moving their endpoints and indexes buffered roads',()=>{
 const layers=decodeVectorTile(mapFixture()),geometry=buildMapGeometry(layers,6),s=geometry.segments;
 assert.equal(s.length%8,0);assert.ok(s.length>32);assert.deepEqual([...s.slice(0,2)],[.125,.5]);
 let roadEnd;for(let i=0;i<s.length;i+=8){assert.ok(Math.max(Math.abs(s[i+2]-s[i]),Math.abs(s[i+3]-s[i+1]))<=1/32);if(s[i+6]===0)roadEnd=[s[i+2],s[i+3]];}
 assert.deepEqual(roadEnd,[.875,.5]);assert.equal(geometry.stateBorders,false);assert.ok(geometry.grid.size>0);
 const boundaries=buildMapGeometry([{name:'boundary',extent:4096,features:[{properties:{admin_level:4},paths:[[0,0,4096,4096]]},{properties:{admin_level:2,maritime:1},paths:[[0,0,4096,0]]}]}],4);
 assert.equal(boundaries.stateBorders,true);for(let i=0;i<boundaries.segments.length;i+=8){assert.equal(boundaries.segments[i+5],5);assert.equal(boundaries.segments[i+6],1);}
});
test('indexed settlement context follows visible roads in flat and sphere modes',()=>{
 const tile={z:6,x:33,y:33},entry={geometry:buildMapGeometry(decodeVectorTile(mapFixture()),6)},view={x:.515625,y:.515625,zoom:6},width=600,height=400;
 for(const camera of [null,sphereCamera(view,width,height,1,4)]){
  const options={view,width,height,camera,zoom:6};
  const label=(x,y)=>({u:(tile.x+x)/64,v:(tile.y+y)/64,point:mapProject(view,width,height,camera,tile,1,x,y)});
  assert.equal(labelNearRoad(label(.68,.5),[{tile,entry}],options),true);
  assert.equal(labelNearRoad(label(.68,.95),[{tile,entry}],options),false);
  assert.equal(labelNearRoad(label(.68,.5),[{tile,entry}],{...options,zoom:3}),false);
 }
});
