import test from 'node:test';
import assert from 'node:assert/strict';
import {matchPlanetaryFeatures} from '../planetary-search.js';
const feature=(name,diameterKm=100)=>({name,diameterKm,x:.5,y:.5,typeCode:'AA'});
test('planetary search ranks exact names before partial names and supports normalized tokens',()=>{
 const features=[feature('Tycho A'),feature('Tycho'),feature('Olympus Mons',600),feature('Café Crater')];
 assert.deepEqual(matchPlanetaryFeatures(features,'tycho','moon').map(f=>f.name),['Tycho']);
 assert.equal(matchPlanetaryFeatures(features,'mons olym','mars')[0].name,'Olympus Mons');
 assert.equal(matchPlanetaryFeatures(features,'cafe','mars')[0].name,'Café Crater');
 assert.deepEqual(matchPlanetaryFeatures(features,'nonexistent','mars'),[]);
 assert.deepEqual(matchPlanetaryFeatures(features,'  ','mars'),[]);
});
test('planetary matches include navigation coordinates and useful body/type details',()=>{
 const result=matchPlanetaryFeatures([feature('Tycho')],'tycho','moon')[0];
 assert.equal(result.latitude,0);assert.equal(result.longitude,0);
 assert.equal(result.diameterKm,100);assert.match(result.details,/Moon · Crater/);
 assert.equal(matchPlanetaryFeatures(Array.from({length:10},(_,i)=>feature(`Test ${i}`,i+1)),'test','mars').length,5);
});
