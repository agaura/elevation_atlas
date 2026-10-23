import {test} from 'node:test';
import assert from 'node:assert/strict';
import {probePosition,sampleProbe} from '../probe.js';
const view={x:.5,y:.5,zoom:2};
test('flat cursor projection uses CSS coordinates, wraps longitude and rejects polar overflow',()=>{
 assert.deepEqual(probePosition(view,800,600,0,256,0),{x:.75,y:.5});
 assert.deepEqual(probePosition({...view,x:.99},800,600,0,256,0),{x:.24,y:.5});
 assert.equal(probePosition(view,800,600,0,0,1000),null);
});
test('sphere probe follows the rotated surface and rejects positions outside the disk',()=>{
 for(const y of [.25,.5,.75]){const p=probePosition({...view,x:.9,y},800,600,0,0,0,true);assert.ok(Math.abs(p.x-.9)<1e-12);assert.ok(Math.abs(p.y-y)<1e-12);}
 assert.equal(probePosition(view,800,600,0,400,300,true),null);
});
test('probe samples finest ready terrain with class-preserving bilinear interpolation',()=>{
 const values=new Float32Array([100,1,200,1,300,1,400,1]);
 const cache=new Map([['0/0/0',{state:'ready',size:2,values}]]);
 assert.deepEqual(sampleProbe(cache,{x:.5,y:.5}),{elevation:250,water:false});
 cache.set('1/1/1',{state:'ready',size:1,values:new Float32Array([600,1])});
 assert.equal(sampleProbe(cache,{x:.6,y:.6}).elevation,600);
 cache.get('1/1/1').state='loading';assert.equal(sampleProbe(cache,{x:.5,y:.5}).elevation,250);
 values[3]=-1;values[7]=-1;
 assert.deepEqual(sampleProbe(cache,{x:.6,y:.5}),{elevation:330,water:true});
 values[6]=NaN;assert.deepEqual(sampleProbe(cache,{x:.9,y:.9}),{elevation:null});
 assert.equal(sampleProbe(new Map(),{x:.5,y:.5}),null);assert.equal(sampleProbe(cache,null),null);
});
