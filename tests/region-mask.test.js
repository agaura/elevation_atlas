import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {administrativeMaskLevel,geometryContains,prepareRegions,findRegion,maskRings} from '../region-geometry.js';
const square=(west,south,east,north)=>[[west,south],[east,south],[east,north],[west,north],[west,south]];
test('region containment handles holes, islands and the antimeridian',()=>{
 const polygon={type:'Polygon',coordinates:[square(0,0,10,10),square(3,3,7,7)]};
 assert.equal(geometryContains(polygon,2,2),true);assert.equal(geometryContains(polygon,5,5),false);
 const crossing={type:'Polygon',coordinates:[square(170,-10,-170,10)]};
 assert.equal(geometryContains(crossing,179,0),true);assert.equal(geometryContains(crossing,-179,0),true);assert.equal(geometryContains(crossing,0,0),false);
 assert.equal(geometryContains({type:'MultiPolygon',coordinates:[polygon.coordinates,[square(20,20,30,30)]]},25,25),true);
});
test('mask detail follows existing country/state/county boundary zoom thresholds',()=>{
 assert.equal(administrativeMaskLevel(4.99),0);assert.equal(administrativeMaskLevel(5),1);assert.equal(administrativeMaskLevel(8.99),1);assert.equal(administrativeMaskLevel(9),2);
});
test('country lookup finds representative administrative parents',()=>{
 const countries=prepareRegions(JSON.parse(readFileSync(new URL('../data/regions/countries.json',import.meta.url))));
 for(const [lon,lat,iso] of [[-87.63,41.88,'USA'],[2.35,48.86,'FRA'],[16.37,48.21,'AUT']])assert.equal(findRegion(countries,lon,lat)?.properties.iso,iso);
 assert.equal(findRegion(countries,-30,0),null);
});
test('raster bounds unwrap dateline polygons locally and preserve holes',()=>{
 const shape=maskRings({type:'Polygon',coordinates:[square(170,-10,-170,10),square(175,-5,-175,5)]},179);
 assert.ok(shape.bounds[2]<.1);assert.equal(shape.rings.length,2);assert.ok(shape.bounds.every(Number.isFinite));
});
