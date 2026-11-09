import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planetaryLabelStyle,planetaryLabelCandidates} from '../planetary-labels.js';
import {mercatorY} from '../planetary.js';

for(const body of ['mars','moon'])test(`${body} catalog contains valid official names and stable coordinates`,()=>{
 const data=JSON.parse(readFileSync(new URL(`../data/planetary/${body}-names.json`,import.meta.url)));
 assert.ok(data.features.length>1000);const ids=new Set();
 for(const [name,lon,lat,diameter,code,id] of data.features){
  assert.ok(name&&code&&Number.isInteger(id));assert.ok(!ids.has(id));ids.add(id);
  assert.ok(Number.isFinite(lon)&&Math.abs(lon)<=180&&Number.isFinite(lat)&&Math.abs(lat)<=90);
  assert.ok(Number.isFinite(diameter)&&diameter>=0);
 }
 assert.ok(data.features.some(f=>f[0]===(body==='mars'?'Olympus Mons':'Mare Tranquillitatis')));
});
test('planetary label hierarchy uses projected feature size, keeping satellite craters for close views',()=>{
 assert.equal(planetaryLabelStyle({typeCode:'AA',diameterKm:20},20),null);
 assert.ok(planetaryLabelStyle({typeCode:'AA',diameterKm:20},40));
 assert.equal(planetaryLabelStyle({typeCode:'SF',diameterKm:20},40),null);
 assert.ok(planetaryLabelStyle({typeCode:'SF',diameterKm:20},70));
 const region=planetaryLabelStyle({typeCode:'ME',diameterKm:900},150),crater=planetaryLabelStyle({typeCode:'AA',diameterKm:100},150);
 assert.ok(region.priority<crater.priority&&region.size>crater.size);
});
test('planetary labels project in flat and sphere modes and reject the hidden hemisphere',()=>{
 const features=[{name:'Near',x:.5,y:.5,diameterKm:1000,typeCode:'AA',id:1},{name:'Far',x:0,y:.5,diameterKm:1000,typeCode:'AA',id:2}];
 const view={x:.5,y:.5,zoom:3},options={view,width:800,height:600,zoom:3};
 assert.deepEqual(planetaryLabelCandidates(features,'moon',{...options,camera:{radius:276}}).map(f=>f.name),['Near']);
 assert.deepEqual(planetaryLabelCandidates(features.slice(0,1),'moon',options)[0].point,[400,300]);
 const polar={...features[0],y:mercatorY(89)};
 assert.ok(Number.isFinite(polar.y));
});
