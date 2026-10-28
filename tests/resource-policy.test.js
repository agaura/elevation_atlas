import test from 'node:test';
import assert from 'node:assert/strict';
import {retryAfterMs,retryDelay,politeFetch,setBackgroundPaused,waitForBackground} from '../request-policy.js';
import {getResource,putResource,resourceLifetime} from '../resource-cache.js';
import {trimTerrain} from '../terrain-cache.js';
test('terrain history retains recent GPU copies and evicts oldest optional data under combined pressure',()=>{
 let destroyed=[];
 const entry=(used)=>({state:'ready',size:2,values:new Float32Array(8),used,texture:{destroy(){destroyed.push(used);}}});
 const cache=new Map([['old',entry(1)],['recent',entry(2)],['visible',entry(3)]]);
 trimTerrain(cache,new Set(['visible']),{budget:1000,gpuBudget:128,extraBytes:0});
 assert.deepEqual(destroyed,[],'Panning alone must not destroy offscreen textures');
 trimTerrain(cache,new Set(['visible']),{budget:130,gpuBudget:128,extraBytes:32});
 assert.deepEqual(destroyed,[1,2]);
 assert.equal(cache.has('old'),false);assert.equal(cache.has('recent'),true);
 assert.ok(cache.get('visible').texture,'Visible data remains protected');
});
test('retry delays honor Retry-After and jitter exponential backoff',()=>{
 assert.equal(retryAfterMs('3'),3000);
 assert.equal(retryAfterMs('Wed, 28 Oct 2026 12:00:00 GMT',Date.parse('2026-10-28T11:59:50Z')),10000);
 assert.equal(retryDelay({retryAfterMs:60000},1,()=>0),60000);
 assert.ok(retryDelay({},3,()=>1)>retryDelay({},1,()=>1));
 assert.equal(retryDelay({name:'TimeoutError'},1,()=>.5),250);
});
test('a provider cooldown prevents neighboring tile requests after HTTP 429',async()=>{
 let requests=0;
 const fetcher=async()=>{requests++;return {ok:false,status:429,headers:new Headers({'retry-after':'60'}),body:{cancel:async()=>{}}};};
 await assert.rejects(politeFetch('https://rate-limit-fixture.invalid/one',{},fetcher),error=>error.retryAfterMs===60000);
 await assert.rejects(politeFetch('https://rate-limit-fixture.invalid/two',{},fetcher),error=>error.status===429);
 assert.equal(requests,1);
});
test('background scheduling pauses until visibility resumes',async()=>{
 setBackgroundPaused(true);let resumed=false;
 const pending=waitForBackground().then(()=>{resumed=true;});
 await Promise.resolve();assert.equal(resumed,false);
 setBackgroundPaused(false);await pending;assert.equal(resumed,true);
});
test('persistent resource cache degrades gracefully without IndexedDB and respects HTTP cache policy',async()=>{
 assert.equal(await getResource('missing'),null);await putResource('x',{data:new ArrayBuffer(1)},1);
 assert.equal(resourceLifetime(new Headers({'cache-control':'no-cache'})),0);
 assert.equal(resourceLifetime(new Headers({'cache-control':'public, max-age=60'})),60000);
});
