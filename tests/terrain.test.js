import {test} from 'node:test';import assert from 'node:assert/strict';import {decode,merge,sourceZoom,visibleTiles,boundedMapY,minimumMapZoom,maximumMapZoom} from '../terrain.js';
test('Terrarium retains sub-metre precision',()=>{assert.equal(decode(128,0,128),.5);assert.equal(decode(127,255,0),-1);});
test('Seascape categories are not elevations',()=>{assert.equal(merge(1450,2),1450);assert.equal(merge(50,-230),-230);assert.equal(merge(50,1),50);assert.equal(merge(50,0),50);});
test('tile selection never undersamples device pixels before source ceiling',()=>{for(const dpr of [1,1.5,2,3,4])for(const zoom of [0,2.3,8.8,14]){const z=sourceZoom(zoom,dpr);assert.ok(512*2**z>=256*2**zoom*dpr);assert.ok(z===0||512*2**(z-1)<256*2**zoom*dpr);}});
test('visible coverage wraps longitude and clips poles',()=>{const tiles=visibleTiles({x:0,y:0,zoom:2},800,600,3);assert.ok(tiles.some(t=>t.x<0));assert.ok(tiles.every(t=>t.y>=0&&t.y<8));assert.ok(tiles.every(t=>!t.key.includes('/-')));});

test('unknown-depth water falls back to Mapterhorn without inventing zero elevations',()=>{assert.equal(merge(472,0),472);assert.equal(merge(-85,0),-85);assert.equal(merge(472,.25),472);assert.ok(Number.isNaN(merge(NaN,0)));assert.equal(merge(472,-.00390625),-.00390625);});

test('shoreline categories and resampled code boundaries retain Mapterhorn elevations',()=>{for(const code of [0,.49,.5,.75,1,1.25,1.49,1.5,2]){assert.equal(merge(612,code),612);assert.equal(merge(-3.5,code),-3.5);assert.ok(Number.isNaN(merge(NaN,code)));}assert.equal(merge(612,-12.75),-12.75);});

test('flat-map viewport stays inside the north and south data boundaries',()=>{for(const height of [500,1000,1800])for(const requestedZoom of [0,2,8]){const zoom=Math.max(minimumMapZoom(height),requestedZoom),half=height/(2*256*2**zoom);assert.ok(half<=.5+1e-12);for(const y of [-10,0,.5,1,10]){const center=boundedMapY(y,zoom,height);assert.ok(center-half>=-1e-12);assert.ok(center+half<=1+1e-12);}}});

test('flat zoom ceiling matches the finest global native texel to one CSS pixel',()=>{
 const sources=[{maxzoom:18,tileSize:512},{maxzoom:16,tileSize:256}];
 const zoom=maximumMapZoom(sources);assert.equal(zoom,19);
 assert.equal(256*2**zoom,512*2**18);
 assert.equal(maximumMapZoom([{maxzoom:18,tileSize:256}]),18);
});
