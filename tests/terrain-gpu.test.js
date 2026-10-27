import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadTerrainTexture} from '../terrain-gpu.js';

test('terrain uploads retain native float elevations and metadata, cache uploads, and restore evicted GPU copies',()=>{
 const previous=globalThis.GPUTextureUsage;
 globalThis.GPUTextureUsage={TEXTURE_BINDING:1,COPY_DST:2,COPY_SRC:4};
 try{
  const textures=[],writes=[];
  const device={createTexture(descriptor){const texture={descriptor};textures.push(texture);return texture;},queue:{writeTexture(...args){writes.push(args);}}};
  const values=new Float32Array([123.456,-8,-999.125,1,1e30,1,0,2]);
  const entry={size:2,values};
  uploadTerrainTexture(device,entry);
  assert.equal(textures[0].descriptor.format,'rg32float');
  assert.equal(writes[0][1],values,'Upload the original floats without conversion');
  assert.deepEqual(writes[0][2],{bytesPerRow:16});
  assert.equal(entry.bytes,64,'Account for both native CPU data and GPU texture');
  const version=entry.textureVersion;
  uploadTerrainTexture(device,entry);
  assert.equal(writes.length,1,'Exposure and repeated draws must reuse the texture');
  delete entry.texture;
  uploadTerrainTexture(device,entry);
  assert.equal(writes.length,2);
  assert.equal(entry.textureVersion,version+1,'A restored texture refreshes the globe atlas');
  assert.equal(writes[1][1],values);
 }finally{if(previous===undefined)delete globalThis.GPUTextureUsage;else globalThis.GPUTextureUsage=previous;}
});
