import {test} from 'node:test';
import assert from 'node:assert/strict';
import {correctWaterSurfaceGrid,waterSurfaceBaseline,mergeWaterSurface} from '../water-surface.js';
test('water baseline rejects shoreline land and isolated low/high outliers',()=>{
 const samples=[1,175,175,175,175,175,175,175,800].map(land=>({land,sea:-10}));
 samples.push({land:3000,sea:2},{land:NaN,sea:-10});
 assert.equal(waterSurfaceBaseline(samples),175);
 assert.equal(mergeWaterSurface(175,-100,175),75);
});
test('lake surface and unknown-depth water join without a polygon cutoff',()=>{
 const land=new Float32Array(9).fill(176),sea=new Float32Array([-10,-10,0,-10,-10,0,2,2,2]);
 const result=correctWaterSurfaceGrid(land,sea,3);
 assert.equal(result[0],166);assert.equal(result[4],166);assert.equal(result[2],176);assert.equal(result[6],176);
 assert.equal(land[0],176,'neighborhood input must remain immutable');
});
test('negative ocean terrain is not offset and missing depths retain Mapterhorn',()=>{
 const land=new Float32Array([-100,0,NaN,175]),sea=new Float32Array([-100,-30,-30,0]);
 assert.deepEqual([...correctWaterSurfaceGrid(land,sea,2)],[-100,-30,-30,175]);
});
test('sloping river baselines can vary locally without a single lake-wide constant',()=>{
 const size=5,land=Float32Array.from({length:25},(_,i)=>170+Math.floor(i/5)),sea=new Float32Array(25).fill(-5);
 const result=correctWaterSurfaceGrid(land,sea,size);
 assert.ok(result[17]>result[7]);assert.ok(result.every(Number.isFinite));
});
test('flat surfaces remain identical on both sides of tile boundaries',()=>{
 const land=new Float32Array(16).fill(176),sea=new Float32Array(16).fill(-12);
 const result=correctWaterSurfaceGrid(land,sea,4,()=>({land:176,sea:-12}));
 assert.ok(result.every(v=>v===164));
});
