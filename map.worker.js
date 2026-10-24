import {decodeVectorTile} from './vector-tile.js';
import {buildMapGeometry} from './map-geometry.js';
const requests=new Map();
self.onmessage=async({data})=>{
 if(data.cancel){requests.get(data.id)?.abort();return;}
 const {id,url,z=0}=data,controller=new AbortController();requests.set(id,controller);
 const timer=setTimeout(()=>controller.abort(),8000);
 try{
  const response=await fetch(url,{signal:controller.signal});if(!response.ok)throw Error(`Map tile HTTP ${response.status}`);
  const buffer=await response.arrayBuffer();if(buffer.byteLength>16*1024*1024)throw Error('Map tile is too large');
  const layers=decodeVectorTile(new Uint8Array(buffer)),geometry=buildMapGeometry(layers,z);if(!controller.signal.aborted)self.postMessage({id,layers,geometry,bytes:buffer.byteLength},[geometry.segments.buffer,...[...geometry.grid.values()].map(indices=>indices.buffer)]);
 }catch(error){self.postMessage({id,error:error.message});}
 finally{clearTimeout(timer);requests.delete(id);}
};
