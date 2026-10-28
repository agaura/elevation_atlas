import test from 'node:test';
import assert from 'node:assert/strict';
import {gebcoSampling, latitudeAt} from '../gebco.js';
import {sourceZoom} from '../terrain.js';
test('GEBCO switches only when native spacing cannot meet requested tile detail', () => {
  assert.equal(gebcoSampling({z:7,y:64}).useGebco,true);
  assert.equal(gebcoSampling({z:8,y:128}).useGebco,false);
  assert.equal(gebcoSampling({z:6,y:0}).useGebco,false);
  assert.equal(gebcoSampling({z:0,y:0}).useGebco,true);
});
test('device pixel ratio advances ocean source choice with terrain LOD', () => {
  const tile = dpr => {const z=sourceZoom(8,dpr);return {z,y:2**(z-1)};};
  assert.equal(gebcoSampling(tile(1)).useGebco,true);
  assert.equal(gebcoSampling(tile(2)).useGebco,false);
});
test('GEBCO overviews never undersample either axis at the poleward edge', () => {
  for(let z=0;z<=7;z++)for(let y=0;y<2**z;y++){
    const s=gebcoSampling({z,y});if(!s.useGebco)continue;
    const step=360/(2**z*512)*Math.cos(Math.max(Math.abs(s.north),Math.abs(s.south))*Math.PI/180);
    assert.ok(2**s.overview/240<=step+1e-12);
  }
  assert.equal(latitudeAt(.5),0);
});
