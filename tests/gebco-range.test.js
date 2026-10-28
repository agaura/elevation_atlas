import test from 'node:test';
import assert from 'node:assert/strict';
import {createRangeClient} from '../gebco-range.js';
function response(start=0,end=65535){return {status:206,headers:new Headers({'content-range':`bytes ${start}-${end}/1000000`}),arrayBuffer:async()=>new Uint8Array(end-start+1).fill(42).buffer};}
test('a cancelled consumer cannot cancel a shared GEBCO range or its retry',async()=>{
  let finish,requests=0,progress=0;
  const client=createRangeClient('fixture',()=>progress++,async(url,options)=>{
    requests++;assert.equal(options.headers.Range,'bytes=0-65535');
    return new Promise(resolve=>{finish=()=>resolve(response());});
  });
  const controller=new AbortController();
  const first=client.request({headers:{Range:'bytes=100-109'},signal:controller.signal});
  controller.abort();
  const retry=client.request({headers:{Range:'bytes=100-109'}});
  await new Promise(resolve=>setTimeout(resolve,0));
  finish();
  assert.equal((await(await first).getData()).byteLength,10);
  assert.deepEqual([...new Uint8Array(await(await retry).getData())],Array(10).fill(42));
  assert.equal(requests,1);assert.equal(progress,1);
  await client.request({headers:{Range:'bytes=500-510'}});
  assert.equal(requests,1,'A nearby slice must reuse downloaded bytes');
});
test('failed GEBCO ranges are removed from the pending cache and retry successfully',async()=>{
  let requests=0;
  const client=createRangeClient('fixture',()=>{},async()=>{if(++requests===1)throw Error('offline');return response();});
  await assert.rejects(client.request({headers:{Range:'bytes=0-100'}}),/offline/);
  assert.equal((await(await client.request({headers:{Range:'bytes=0-100'}})).getData()).byteLength,101);
  assert.equal(requests,2);
});
test('GEBCO rejects full-file responses and truncated ranges before caching',async()=>{
  let cancelled=false;
  const full=createRangeClient('fixture',()=>{},async()=>({status:200,body:{cancel:async()=>{cancelled=true;}}}));
  await assert.rejects(full.request({headers:{Range:'bytes=0-100'}}),/HTTP 200/);assert.equal(cancelled,true);
  const short=createRangeClient('fixture',()=>{},async()=>({...response(),arrayBuffer:async()=>new ArrayBuffer(10)}));
  await assert.rejects(short.request({headers:{Range:'bytes=0-100'}}),/Truncated/);
});
