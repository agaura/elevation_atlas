import {getResource,putResource,resourceLifetime} from './resource-cache.js';
import {politeFetch} from './request-policy.js';
import {decodeVectorTile} from './vector-tile.js';
import {buildMapGeometry} from './map-geometry.js';
const requests=new Map();
self.onmessage=async({data})=>{
 if(data.cancel){requests.get(data.id)?.abort();return;}
 const {id,url,z=0}=data,controller=new AbortController();requests.set(id,controller);
 const timer=setTimeout(()=>controller.abort(),8000);
 try{
  const key='map-vector-v1:'+url;
  const stored=await getResource(key);let buffer=stored?.data;
  if(!buffer){
   const response=await politeFetch(url,{signal:controller.signal});if(!response.ok)throw Error(`Map tile HTTP ${response.status}`);
   buffer=await response.arrayBuffer();if(buffer.byteLength>16*1024*1024)throw Error('Map tile is too large');
   void putResource(key,{data:buffer},buffer.byteLength,resourceLifetime(response.headers));
  }
  controller.signal.throwIfAborted();
  const layers=decodeVectorTile(new Uint8Array(buffer)),geometry=buildMapGeometry(layers,z);if(!controller.signal.aborted)self.postMessage({id,layers,geometry,bytes:buffer.byteLength},[geometry.segments.buffer,...[...geometry.grid.values()].map(indices=>indices.buffer)]);
 }catch(error){self.postMessage({id,error:error.message,status:error.status,retryAfterMs:error.retryAfterMs||0});}
 finally{clearTimeout(timer);requests.delete(id);}
};
