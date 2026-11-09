import test from 'node:test';
import assert from 'node:assert/strict';
import {planetaryMeshCover,availableMeshAddress,planetaryMeshZoom,decodeTerrainMesh,meshBounds,meshAvailable,meshHeight,rasterizeMesh,latitudeAt,BODIES} from '../planetary.js';
import {distanceScale} from '../scale-bar.js';
function fixture(){
 const bytes=new ArrayBuffer(92+18+4+6),v=new DataView(bytes);
 v.setFloat32(24,-100,true);v.setFloat32(28,100,true);v.setUint32(88,3,true);
 const zigzag=n=>(n<<1)^(n>>31);
 for(const [axis,values] of [[0,[0,32767,0]],[1,[0,0,32767]],[2,[0,32767,32767]]]){
  let previous=0;values.forEach((value,i)=>{v.setUint16(92+axis*6+i*2,zigzag(value-previous),true);previous=value;});
 }
 v.setUint32(110,1,true);[0,0,0].forEach((code,i)=>v.setUint16(114+i*2,code,true));return bytes;
}
test('planetary meshes decode signed vertex deltas and high-watermark indices',()=>{
 const mesh=decodeTerrainMesh(fixture());assert.deepEqual([...mesh.indices],[0,1,2]);
 assert.equal(meshHeight(mesh,.25,.25),0);assert.ok(Number.isNaN(meshHeight(mesh,.8,.8)));
 assert.throws(()=>decodeTerrainMesh(new ArrayBuffer(8)),/Incomplete/);
 const bad=fixture();new DataView(bad).setUint16(114,10,true);assert.throws(()=>decodeTerrainMesh(bad),/index/);
});
test('geographic mesh rasterization evaluates actual Mercator pixel centers',()=>{
 const mesh={positions:Float32Array.from([0,0,0,1,0,100,0,1,200,1,1,300]),indices:Uint32Array.from([0,1,2,1,3,2])};
 const bounds={west:-180,east:180,south:-90,north:90},size=16,values=new Float32Array(size*size).fill(NaN);
 rasterizeMesh(mesh,bounds,{z:0,x:0,y:0},size,values);
 for(let row=0;row<size;row++)for(let col=0;col<size;col++){
  const expected=100*(col+.5)/size+200*(latitudeAt((row+.5)/size)+90)/180;
  assert.ok(Math.abs(values[row*size+col]-expected)<.0001);
 }
});
test('planetary TMS availability, geography and scale use each body radius',()=>{
 assert.deepEqual(meshBounds(0,1,0),{west:0,east:180,south:-90,north:90});
 assert.equal(meshAvailable({available:[[{startX:0,endX:1,startY:0,endY:0}]]},0,1,0),true);
 assert.equal(meshAvailable({available:[]},3,0,0),false);
 const view={zoom:4,y:.5};
 for(const body of ['mars','moon']){
  const {label,width}=distanceScale(view,800,null,BODIES[body].radius);
  const distance=Number.parseFloat(label)*(label.endsWith('km')?1000:1);
  assert.ok(Math.abs(distance/width-2*Math.PI*BODIES[body].radius/(256*2**view.zoom))<1e-6);
 }
});

test('visible planetary tiles use denser meshes while previews and unavailable detail stay bounded',()=>{
 const manifest={available:Array.from({length:7},(_,z)=>[{startX:0,endX:2**(z+1)-1,startY:0,endY:2**z-1}])};
 assert.equal(planetaryMeshZoom(0,manifest),0);
 assert.equal(planetaryMeshZoom(3,manifest),5);
 assert.equal(planetaryMeshZoom(6,manifest),6);
 manifest.available[5]=[];
 assert.deepEqual(availableMeshAddress(manifest,5,10,12),{z:4,x:5,y:6});
});

test('polar mesh coverage refines stretched Mercator rows with bounded requests and symmetric coverage',()=>{
 const manifest={available:Array.from({length:14},(_,z)=>[{startX:0,endX:2**(z+1)-1,startY:0,endY:2**z-1}])};
 const north=planetaryMeshCover({z:4,x:3,y:0},512,manifest),south=planetaryMeshCover({z:4,x:3,y:15},512,manifest);
 const equator=planetaryMeshCover({z:4,x:3,y:7},512,manifest);
 assert.ok(north.some(a=>a.z>planetaryMeshZoom(4,manifest)));
 assert.ok(Math.max(...equator.map(a=>a.z))<Math.max(...north.map(a=>a.z)));
 assert.ok(north.length<=192&&south.length<=192);
 assert.deepEqual(north.map(a=>`${a.z}/${a.x}/${2**a.z-1-a.y}`).sort(),south.map(a=>`${a.z}/${a.x}/${a.y}`).sort());
 const tile={z:4,x:3,y:0};
 for(let row=0;row<9;row++)for(let col=0;col<9;col++){
  const lon=(tile.x+(col+.5)/9)/2**tile.z*360-180,lat=latitudeAt((tile.y+(row+.5)/9)/2**tile.z);
  assert.ok(north.some(a=>{const b=meshBounds(a.z,a.x,a.y);return lon>=b.west&&lon<=b.east&&lat>=b.south&&lat<=b.north;}));
 }
 const preview=planetaryMeshCover({z:0,x:0,y:0},512,manifest);assert.equal(preview.length,2);assert.ok(preview.every(a=>a.z===0));
});
