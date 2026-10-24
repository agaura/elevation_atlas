import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCoordinates,mercator,searchDestination,geocoderLocations} from '../search.js';
test('search parses decimal, cardinal and DMS coordinates without treating addresses as coordinates',()=>{
 for(const text of ['40.7, -74','40.7 -74','geo:40.7,-74','[40.7,-74]','40.7 N, 74 W','74 W, 40.7 N'])assert.deepEqual(parseCoordinates(text),{latitude:40.7,longitude:-74});
 const dms=parseCoordinates('40°42′46″N 74°0′21″W');assert.ok(Math.abs(dms.latitude-40.71277778)<1e-7);assert.ok(Math.abs(dms.longitude+74.00583333)<1e-7);
 assert.equal(parseCoordinates('1600 Pennsylvania Avenue, Washington'),null);assert.throws(()=>parseCoordinates('91, 0'));assert.throws(()=>parseCoordinates('40, 181'));assert.throws(()=>parseCoordinates('89, 0'),/coverage/);assert.throws(()=>parseCoordinates('40°70′N 74°0′W'));
});
test('search fits geocoder extents and produces equivalent flat/sphere center scale',()=>{
 const point={latitude:40,longitude:-74},d=searchDestination(point,1000,800),m=mercator(40,-74);assert.equal(d.x,m.x);assert.equal(d.y,m.y);assert.equal(d.zoom,14);
 const sphereRadius=.46*800*2**d.sphereZoom;assert.ok(Math.abs(2*Math.PI*sphereRadius*Math.cos(40*Math.PI/180)/(256*2**d.zoom)-1)<1e-12);
 const city=searchDestination({...point,bounds:[-75,41,-73,39]},1000,800),country=searchDestination({...point,bounds:[-100,50,-60,25]},1000,800);assert.ok(city.zoom>country.zoom);assert.ok(city.zoom<14);
});
test('geocoder results keep disambiguating addresses and reject invalid geographic positions',()=>{
 const result=geocoderLocations([{geometry:{type:'Point',coordinates:[-77,39]},properties:{name:'White House',housenumber:'1600',street:'Pennsylvania Ave',city:'Washington',country:'United States',extent:[-77.1,39.1,-76.9,38.9]}},{geometry:{type:'Point',coordinates:[200,99]}}]);assert.equal(result.length,1);assert.match(result[0].details,/1600 Pennsylvania Ave/);assert.equal(result[0].longitude,-77);assert.deepEqual(result[0].bounds,[-77.1,39.1,-76.9,38.9]);
});
