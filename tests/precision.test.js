import {test} from 'node:test';
import assert from 'node:assert/strict';
import {quantizeTerrain,buildExposureIndex,nativeExposure,LowPrecisionUpdates,byteTextureReady,selectByteUploads} from '../precision.js';
import {sphereCamera} from '../sphere.js';
test('8-bit terrain rounds to the nearest of 256 elevation steps and preserves water, nodata and parent spacing',()=>{
 const data=new Float32Array([-11,1,-10,-1,0.49,1,0.51,16,245,-16,300,1,NaN,1]);
 const bytes=quantizeTerrain(data,-10,245);assert.deepEqual([...bytes],[0,1,0,129,10,1,11,5,255,133,255,1,0,0]);assert.equal(bytes.byteLength,data.byteLength/4);
 const target=new Uint8Array(data.length);assert.equal(quantizeTerrain(data,-10,245,target),target);assert.equal(data[0],-11);
});
test('native exposure statistics retain unclipped extrema and water classification',()=>{
 const size=16,values=new Float32Array(size*size*2);for(let i=0;i<size*size;i++){values[i*2]=i-50;values[i*2+1]=i===255?-1:1;}
 const entry={size,values,state:'ready',exposureIndex:buildExposureIndex(values,size)},cache=new Map([['0/0/0',entry]]),tiles=[{key:'0/0/0',x:0,y:0,z:0,left:0,top:0,size:512}];
 const options={tiles,cache,width:512,height:512};assert.deepEqual(nativeExposure(options),[-50,205]);assert.deepEqual(nativeExposure({...options,noOcean:true}),[-50,204]);
 quantizeTerrain(values,0,1);assert.deepEqual(nativeExposure(options),[-50,205]);
 const cropped=nativeExposure({...options,tiles:[{...tiles[0],sourceKey:'0/0/0',uv:[.5,.5,.5]}]});assert.ok(cropped[0]>=69&&cropped[1]===205);
});
test('native globe exposure rejects hidden elevations and excludes water without depending on byte ranges',()=>{
 const size=16,values=new Float32Array(size*size*2);for(let i=0;i<values.length;i+=2){values[i]=600;values[i+1]=1;}
 values[(8*size)*2]=20000;values[(8*size+8)*2]=1000;values[(8*size+8)*2+1]=-1;
 const entry={size,values,state:'ready'},cache=new Map([['0/0/0',entry]]),tiles=[{key:'0/0/0',x:0,y:0,z:0}],sphere=sphereCamera({x:.5,y:.5},800,600);
 assert.deepEqual(nativeExposure({tiles,cache,sphere,width:800,height:600}),[600,1000]);assert.deepEqual(nativeExposure({tiles,cache,sphere,width:800,height:600,noOcean:true}),[600,600]);
});

test('byte encoding commits only the latest settled target, never each exposure animation frame',()=>{
 const schedule=new LowPrecisionUpdates(0,1000);schedule.touch(100);assert.equal(schedule.ready(279),false);assert.equal(schedule.ready(280,true),false);
 assert.equal(schedule.commit(-100,1500,280,false,true),false);assert.equal(schedule.commit(-100,1500,280),true);
 for(let i=0;i<30;i++)assert.equal(schedule.commit(-100,1500,300+i*16),false);
 schedule.touch(900);assert.equal(schedule.commit(200,800,1000),false);assert.equal(schedule.commit(250,850,1080),true);assert.equal(schedule.min,250);assert.equal(schedule.max,850);
});
test('byte upload staging bounds work, prioritizes parent previews and rejects stale encoding ranges',()=>{
 const entry=()=>({state:'ready'}),parent=entry(),a=entry(),b=entry(),c=entry(),entries=[parent,a,a,b,c,{state:'loading'}];
 const first=selectByteUploads(entries,0,1000,2);assert.deepEqual(first.selected,[parent,a]);assert.equal(first.pending,true);
 for(const e of first.selected)Object.assign(e,{texture:{},textureFormat:'rg8unorm',textureMin:0,textureMax:1000});
 assert.equal(byteTextureReady(parent,0,1000),true);assert.equal(byteTextureReady(parent,0,2000),false);
 const second=selectByteUploads(entries,0,1000,2);assert.deepEqual(second.selected,[b,c]);assert.equal(second.pending,false);
 assert.deepEqual(selectByteUploads(entries,0,2000,1).selected,[parent]);
});
