import {getResource,putResource} from './resource-cache.js';
import {politeFetch,waitForBackground} from './request-policy.js';
// Shared byte ranges outlive individual viewport tiles. Cancelling one tile
// must not abort bytes still needed by another tile or its immediate retry.
export function createRangeClient(url, onProgress, fetcher = fetch) {
  const blockSize = 65536, budget = 8 * 1024 * 1024;
  const cache = new Map(), pending = new Map();
  let bytes = 0, active = 0, validation;
  async function validStored(block) {
    if(!block?.etag)return false;
    if(!validation)validation=(async()=>{
      await waitForBackground();
      const response=await politeFetch(url,{method:'HEAD',signal:AbortSignal.timeout(8000)},fetcher);
      return response.ok?response.headers.get('etag'):null;
    })().catch(error=>{validation=null;if(error.status===429||error.status===503)throw error;return null;});
    return (await validation)===block.etag;
  }
  const waiting = [];
  async function download(start, end) {
    if (active >= 6) await new Promise(resolve => waiting.push(resolve));
    else active++;
    try {
      const diskKey=`gebco-range-v1:${url}:${start}-${end}`;
      let block=await getResource(diskKey);
      if(block&&!await validStored(block))block=null;
      if(!block){
      await waitForBackground();
      const response = await politeFetch(url, {headers: {Range: `bytes=${start}-${end}`}, signal: AbortSignal.timeout(8000)}, fetcher);
      if (response.status !== 206) {
        await response.body?.cancel();
        throw new Error(`GEBCO range request returned HTTP ${response.status}`);
      }
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
      if (!match || Number(match[1]) !== start) throw new Error('Invalid GEBCO byte range');
      const data = await response.arrayBuffer();
      if (data.byteLength !== Number(match[2]) - start + 1) throw new Error('Truncated GEBCO byte range');
      block = {start, end: Number(match[2]), total: Number(match[3]), data, etag: response.headers.get('etag')};
      void putResource(diskKey,block,data.byteLength);
      }
      const data=block.data;
      if (data.byteLength <= budget) {
        cache.set(start + ':' + end, block);bytes += data.byteLength;
        while (bytes > budget) {const key = cache.keys().next().value;bytes -= cache.get(key).data.byteLength;cache.delete(key);}
      }
      onProgress();
      return block;
    } finally {
      if (waiting.length) waiting.shift()();
      else active--;
    }
  }
  return {
    async request({headers} = {}) {
      const match = /^bytes=(\d+)-(\d+)$/.exec(headers.Range);
      if (!match) throw new Error('GEBCO requires a single byte range');
      const offset = Number(match[1]), last = Number(match[2]);
      const start = Math.floor(offset / blockSize) * blockSize;
      const end = Math.ceil((last + 1) / blockSize) * blockSize - 1;
      let block;
      for (const [key, candidate] of cache) {
        if (candidate.start <= offset && candidate.end >= last) {
          block = candidate;cache.delete(key);cache.set(key, candidate);break;
        }
      }
      if (!block) {
        const key = start + ':' + end;
        let promise = pending.get(key);
        if (!promise) {
          promise = download(start, end).finally(() => pending.delete(key));
          pending.set(key, promise);
        }
        block = await promise;
      }
      return {
        ok: true, status: 206,
        getHeader: name => name.toLowerCase() === 'content-range' ? `bytes ${offset}-${Math.min(last, block.end)}/${block.total}` : undefined,
        getData: async () => block.data.slice(offset - block.start, Math.min(last, block.end) - block.start + 1),
      };
    },
  };
}
